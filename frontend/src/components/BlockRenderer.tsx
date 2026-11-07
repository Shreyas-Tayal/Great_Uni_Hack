// The AI-first core: the accountant answers with visuals. n8n decides WHICH blocks, the engine supplies the numbers.
import type { Adjustment, Block } from "@/lib/types";
import ForecastChart from "./ForecastChart";
import { Actions, AlertCard, Kpis, ScenarioDelta, UpcomingList } from "./Cards";
import { CashflowChart, CategoryChart, InvoiceTable } from "./Charts";

interface Props { block: Block; profileId: string; onApply?: (a: Adjustment, label: string) => void }

export default function BlockRenderer({ block, profileId, onApply }: Props) {
  switch (block.type) {
    case "kpis": return <Kpis items={block.items} />;
    case "forecast_chart": return <div className="fs-surface p-3"><ForecastChart {...block.data} height={220} /></div>;
    case "scenario_delta": return <ScenarioDelta focus={block.focus} />;
    case "alert": return <AlertCard alert={block.alert} onApply={onApply} />;
    case "actions": return <Actions actions={block.actions} onApply={onApply} />;
    case "category_chart": return <CategoryChart data={block.data} />;
    case "cashflow_chart": return <CashflowChart data={block.data} />;
    case "upcoming": return <UpcomingList items={block.items} />;
    case "invoices": return <InvoiceTable items={block.items} profileId={profileId} />;
    default: return null;
  }
}
