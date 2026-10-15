import type { CheckpointRiskLevel } from '../api/plan';

/**
 * The one risk palette: checkpoints, the legend and (later) the heatmap all take their colours
 * and wording from here. A colour is never the only signal: every level has a text label too.
 * No data is grey, and kept apart from Low's green so a missing forecast never looks safe.
 */
interface RiskStyle {
  code: CheckpointRiskLevel;
  label: string;
  /** `#rrggbb`. */
  color: string;
}

export const RISK_LEVELS: readonly RiskStyle[] = [
  { code: 'low', label: 'Low', color: '#2e9e5b' },
  { code: 'moderate', label: 'Moderate', color: '#f2c230' },
  { code: 'high', label: 'High', color: '#ef8a17' },
  { code: 'severe', label: 'Severe', color: '#d6342c' },
  { code: 'no_travel', label: 'No Travel', color: '#5b1a6e' },
  { code: 'no_data', label: 'No data', color: '#9ba3b2' },
];

export function riskStyle(code: CheckpointRiskLevel): RiskStyle {
  return RISK_LEVELS.find((level) => level.code === code)!;
}
