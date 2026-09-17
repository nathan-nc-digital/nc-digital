// Date/time inputs use the business timezone even when Nathan is travelling.
export function londonInput(value) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
  const p=type=>parts.find(v=>v.type===type).value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
}
export function londonInstant(value) {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Choose a valid London date and time.');
  const base=Date.parse(value+'Z');
  if(!Number.isFinite(base))throw Error('Choose a valid London date and time.');
  const candidates=[base,base-3600000].filter(t=>londonInput(t)===value);
  if(candidates.length!==1)throw Error('This time is skipped or repeated when UK clocks change. Choose a different time.');
  return new Date(candidates[0]).toISOString();
}
