import os
import copy
import tempfile
from pathlib import Path

import numpy as np
import unittest
from unittest.mock import patch, Mock

import httpx
from fastapi.testclient import TestClient
from main import app, model_for, post_simulate, ForecastReq
from foresight.engine import _simulate, forecast, summary
from foresight.recurring import Detection
from uvicorn import Config


class VoiceTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_missing_config(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(self.client.post('/voice/session', json={'profile_id': 'amara'}).status_code, 503)

    def test_signed_url_and_context(self):
        response = Mock()
        response.json.return_value = {'signed_url': 'wss://example.test/signed'}
        with patch.dict(os.environ, {'ELEVENLABS_API_KEY': 'secret', 'ELEVENLABS_AGENT_ID': 'agent_test'}), patch('main.httpx.get', return_value=response) as get:
            result = self.client.post('/voice/session', json={'profile_id': 'amara'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.headers['cache-control'], 'no-store')
        expected = [{k: row[k] for k in ('stream_id', 'label', 'amount')}
                    for row in summary(model_for('amara'))['recurring'] if row['direction'] == 'in']
        self.assertEqual(result.json()['income_streams'], expected)
        self.assertNotIn('secret', result.text)
        self.assertEqual(get.call_args.kwargs['headers'], {'xi-api-key': 'secret'})

    def test_provider_failure_is_sanitized(self):
        with patch.dict(os.environ, {'ELEVENLABS_API_KEY': 'secret', 'ELEVENLABS_AGENT_ID': 'agent_test'}), patch('main.httpx.get', side_effect=httpx.ConnectError('secret')):
            result = self.client.post('/voice/session', json={'profile_id': 'amara'})
        self.assertEqual(result.status_code, 502)
        self.assertNotIn('secret', result.text)

    def test_week_late_matches_existing_engine(self):
        stream = next(s for s in model_for('amara').det.cadence if s.direction == 'in')
        result = self.client.post('/voice/simulate', json={'profile_id': 'amara', 'stream_id': stream.id, 'days': 7})
        self.assertEqual(result.status_code, 200)
        expected = post_simulate(ForecastReq(profile_id='amara', adjustments=[{'type': 'shift_stream', 'stream_id': stream.id, 'days': 7}]))
        self.assertEqual(result.json()['result'], expected)
        self.assertNotEqual(expected['scenario']['risk_summary']['low_point_p50'], expected['baseline']['low_point_p50'])
        self.assertEqual(len(expected['scenario']['bands']), 90)

    def test_invalid_tool_arguments(self):
        stream = next(s for s in model_for('amara').det.cadence if s.direction == 'in')
        for changes in [{'stream_id': 'rent_out'}, {'stream_id': 'invented'}, {'days': 0}, {'days': 91}, {'days': '7'}, {'days': 1.5}]:
            result = self.client.post('/voice/simulate', json={'profile_id': 'amara', 'stream_id': stream.id, 'days': 7, **changes})
            self.assertEqual(result.status_code, 422)
        self.assertEqual(self.client.post('/voice/session', json={'profile_id': '../README'}).status_code, 404)
        self.assertEqual(self.client.post('/voice/session', json={'profile_id': 'missing'}).status_code, 404)

    def test_all_demo_income_types_change_the_forecast(self):
        for pid in ['amara', 'jay', 'sam', 'corner_cup', 'lumen_labs']:
            m = model_for(pid)
            base = forecast(m, 90, [], with_actions=False)
            for stream in [*m.det.cadence, *m.det.weekday]:
                if stream.direction != 'in':
                    continue
                with self.subTest(profile=pid, stream=stream.id):
                    response = self.client.post('/voice/simulate', json={
                        'profile_id': pid, 'stream_id': stream.id, 'days': 7})
                    self.assertEqual(response.status_code, 200, response.text)
                    result = response.json()['result']
                    self.assertNotEqual(result['scenario']['bands'], base['bands'])
                    self.assertEqual(result['baseline']['low_point_p50'], base['risk_summary']['low_point_p50'])
                    self.assertEqual(result['scenario']['profile_id'], pid)

    def test_irregular_income_context_and_delay(self):
        with patch.dict(os.environ, {'ELEVENLABS_API_KEY': 'secret', 'ELEVENLABS_AGENT_ID': 'agent_test'}), patch('main.httpx.get') as get:
            get.return_value.json.return_value = {'signed_url': 'wss://example.test/signed'}
            response = self.client.post('/voice/session', json={'profile_id': 'corner_cup'})
        self.assertEqual(response.json()['income_streams'][0]['stream_id'], 'sumup_payout_in')
        m = copy.deepcopy(model_for('corner_cup'))
        stream = next(s for s in m.det.weekday if s.direction == 'in')
        m.det = Detection(weekday=[stream])
        m.invoices = []
        m.residual_by_wd = [np.array([0.0])] * 7
        base, _ = _simulate(m, 90, [], n=64)
        after, _ = _simulate(m, 90, [{'type': 'shift_stream', 'stream_id': stream.id, 'days': 7}], n=64)
        base_flows = np.diff(base, prepend=np.full((64, 1), m.balance), axis=1)
        after_flows = np.diff(after, prepend=np.full((64, 1), m.balance), axis=1)
        np.testing.assert_allclose(after_flows[:, :7], 0, atol=1e-8)
        np.testing.assert_allclose(after_flows[:, 7:], base_flows[:, :-7], atol=1e-8)

    def test_cadence_delay_keeps_common_random_draws_at_horizon(self):
        m = copy.deepcopy(model_for('jay'))
        stream = next(s for s in m.det.cadence if s.direction == 'in')
        m.det = Detection(cadence=[stream])
        m.invoices = []
        m.residual_by_wd = [np.array([0.0])] * 7
        base, _ = _simulate(m, 90, [], n=64)
        after, _ = _simulate(m, 90, [{'type': 'shift_stream', 'stream_id': stream.id, 'days': 7}], n=64)
        base_flows = np.diff(base, prepend=np.full((64, 1), m.balance), axis=1)
        after_flows = np.diff(after, prepend=np.full((64, 1), m.balance), axis=1)
        np.testing.assert_allclose(after_flows[:, :7], 0, atol=1e-8)
        np.testing.assert_allclose(after_flows[:, 7:], base_flows[:, :-7], atol=1e-8)

    def test_delaying_one_stream_does_not_resample_other_income(self):
        m = copy.deepcopy(model_for('jay'))
        selected, other = [s for s in m.det.cadence if s.direction == 'in'][:2]
        m.det = Detection(cadence=[selected, other])
        m.invoices = []
        m.residual_by_wd = [np.array([0.0])] * 7
        adjustment = [{'type': 'shift_stream', 'stream_id': selected.id, 'days': 7}]
        base, _ = _simulate(m, 90, [], n=64)
        after, _ = _simulate(m, 90, adjustment, n=64)
        m.det = Detection(cadence=[selected])
        selected_base, _ = _simulate(m, 90, [], n=64)
        selected_after, _ = _simulate(m, 90, adjustment, n=64)
        np.testing.assert_allclose(after - base, selected_after - selected_base, atol=1e-8)

    def test_unknown_cross_profile_expense_and_invalid_days(self):
        for pid in ['missing', 'index', '../amara']:
            for route in ['/voice/session', '/voice/simulate']:
                with self.subTest(profile=pid, route=route):
                    with patch('main.httpx.get') as provider:
                        response = self.client.post(route, json={'profile_id': pid, 'stream_id': 'sumup_payout_in', 'days': 7})
                    self.assertEqual(response.status_code, 404)
                    provider.assert_not_called()
        for sid in ['sumup_payout_in', 'netflix_com_out']:
            self.assertEqual(self.client.post('/voice/simulate', json={
                'profile_id': 'amara', 'stream_id': sid, 'days': 7}).status_code, 422)
        for value in [True, False, None, -1, 0, 91, '7', 1.5]:
            self.assertEqual(self.client.post('/voice/simulate', json={
                'profile_id': 'amara', 'stream_id': 'brightcare_ltd_salary_in', 'days': value}).status_code, 422)
        for value in [1, 90]:
            self.assertEqual(self.client.post('/voice/simulate', json={
                'profile_id': 'amara', 'stream_id': 'brightcare_ltd_salary_in', 'days': value}).status_code, 200)

    def test_no_effect_returns_explicit_error(self):
        m = copy.deepcopy(model_for('corner_cup'))
        stream = next(s for s in m.det.weekday if s.direction == 'in')
        stream.p_by_weekday = [0] * 7
        with patch('main.model_for', return_value=m):
            response = self.client.post('/voice/simulate', json={
                'profile_id': 'corner_cup', 'stream_id': stream.id, 'days': 7})
        self.assertEqual(response.status_code, 422)
        self.assertIn('no forecast receipts affected', response.json()['detail'])

    def test_upstream_http_timeout_and_malformed_payloads(self):
        for status in [401, 403, 429, 500]:
            with self.subTest(status=status), patch.dict(os.environ, {'ELEVENLABS_API_KEY': 'secret', 'ELEVENLABS_AGENT_ID': 'agent_test'}), patch('main.httpx.get', return_value=httpx.Response(status, request=httpx.Request('GET', 'https://example.test'), text='secret')):
                response = self.client.post('/voice/session', json={'profile_id': 'amara'})
                self.assertEqual(response.status_code, 502)
                self.assertNotIn('secret', response.text)
        for payload in [{}, None, [], {'signed_url': 12}, {'signed_url': 'https://invalid.test'}]:
            with self.subTest(payload=payload), patch.dict(os.environ, {'ELEVENLABS_API_KEY': 'secret', 'ELEVENLABS_AGENT_ID': 'agent_test'}), patch('main.httpx.get') as get:
                get.return_value.json.return_value = payload
                self.assertEqual(self.client.post('/voice/session', json={'profile_id': 'amara'}).status_code, 502)
        for failure in [httpx.ReadTimeout('secret'), ValueError('secret')]:
            with patch.dict(os.environ, {'ELEVENLABS_API_KEY': 'secret', 'ELEVENLABS_AGENT_ID': 'agent_test'}), patch('main.httpx.get', side_effect=failure):
                response = self.client.post('/voice/session', json={'profile_id': 'amara'})
                self.assertEqual(response.status_code, 502)
                self.assertNotIn('secret', response.text)

    def test_documented_env_file_loading(self):
        # Dummy values only: verify the uvicorn startup flag, without reading local secrets.
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            env_file = Path(directory) / '.env'
            env_file.write_text('ELEVENLABS_API_KEY=dummy\nELEVENLABS_AGENT_ID=agent_dummy\n')
            Config('main:app', env_file=str(env_file))
            self.assertEqual(os.environ['ELEVENLABS_API_KEY'], 'dummy')
            self.assertEqual(os.environ['ELEVENLABS_AGENT_ID'], 'agent_dummy')


if __name__ == '__main__':
    unittest.main()
