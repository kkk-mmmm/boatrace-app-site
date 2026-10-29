import {conditionalReport} from '../tools/prediction/conditional_records.mjs';
import {coverageSummary} from './coverage-summary.mjs';
export function strategyDashboard(directory,definition,{now=Date.now()}={}){const report=conditionalReport(directory,definition,{now});return {...report,generated_at:new Date(now).toISOString(),coverage:coverageSummary(directory,definition,report,{now}),days:report.days.map(d=>({...d,records:d.records.map(r=>({...r,conditions:r.conditions.map(({combos,...c})=>c)}))}))};}
