// The AI-first core: the accountant answers with visuals. The model picks WHICH blocks; the engine supplies the numbers.
import { createContext, useContext } from "react";
import type { Adjustment, Block } from "@/lib/types";
import ForecastChart from "./ForecastChart";
import { Actions, AlertCard, DraftCard, Kpis, ScenarioDelta, UpcomingList } from "./Cards";
import { CashflowChart, CategoryChart, InvoiceTable } from "./Charts";

/** Lets any Approve button in any message reach the page, and know what's already approved. */
export const ApproveContext = createContext<{ approve: (a: Adjustment, label: string) => void; approved: string[]; working: string | null }>({ approve: () => undefined, approved: [], working: null });

export default function BlockRenderer({ block, profileId }: { block: Block; profileId: string }) {
  const { approve, approved, working } = useContext(ApproveContext);
  switch (block.type) {
    case "kpis": return <Kpis items={block.items} />;
    case "forecast_chart": return <div className="fs-surface p-3"><ForecastChart {...block.data} height={220} /></div>;
    case "scenario_delta": return <ScenarioDelta focus={block.focus} />;
    case "alert": return <AlertCard alert={block.alert} onApply={approve} approved={approved} applying={working} />;
    case "actions": return <div className="fs-surface p-4"><div className="text-sm font-medium">Fixes I've tested</div><Actions actions={block.actions} onApply={approve} approved={approved} applying={working} /></div>;
    case "category_chart": return <CategoryChart data={block.data} />;
    case "cashflow_chart": return <CashflowChart data={block.data} />;
    case "upcoming": return <UpcomingList items={block.items} totals limit={8} />;
    case "invoices": return <InvoiceTable items={block.items} profileId={profileId} />;
    case "draft": return <DraftCard draft={block.draft} />;
    default: return null;
  }
}
