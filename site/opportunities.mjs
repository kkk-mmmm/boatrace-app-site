import {raceStatus} from './public/view.mjs';
export function opportunityList(snapshots,now=Date.now()){
  const opportunities=[];
  for(const venue of snapshots){
    const success=Date.parse(venue.update.last_success_at);
    if(!Number.isFinite(success)||success>now+60000||now-success>10*60000)continue;
    for(const race of venue.races){
      if(!race.opportunity || !raceStatus(race,venue,now).currentOdds || race.opportunity.value<=1)continue;
      opportunities.push({venue_code:venue.venue_code,venue:venue.venue,date:race.date,race_no:race.race_no,
        deadline_at:race.deadline_at,model_name:race.model_name || '固定スコアモデル v1',...race.opportunity,
        fetched_at:race.odds.fetched_at,recorded_at:race.odds.recorded_at,classification:race.odds.classification,
        update_status:venue.update.status,last_success_at:venue.update.last_success_at});
    }
  }
  return opportunities.sort((a,b)=>b.value-a.value||a.deadline_at.localeCompare(b.deadline_at)||a.venue_code.localeCompare(b.venue_code)).slice(0,6);
}
