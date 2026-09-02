export function robotsAllows(text: string, pathname: string): boolean {
  let agents: string[] = []; let rulesStarted = false;
  const groups: { agents:string[]; rules:{ allow:boolean; path:string }[] }[] = [];
  let current: typeof groups[number] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = (raw.split('#')[0] ?? '').trim(); const colon = line.indexOf(':'); if (colon < 0) continue;
    const key = line.slice(0,colon).trim().toLowerCase(), value = line.slice(colon+1).trim();
    if (key === 'user-agent') {
      if (rulesStarted || !current) { agents = []; current = { agents, rules:[] }; groups.push(current); rulesStarted = false; }
      agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) {
      rulesStarted = true; if (value) current.rules.push({ allow:key === 'allow', path:value });
    }
  }
  const specific = groups.filter(g => g.agents.some(a => a !== '*' && 'lepefyprospects'.includes(a)));
  const selected = specific.length ? specific : groups.filter(g => g.agents.includes('*'));
  let winner: { allow:boolean; length:number } | null = null;
  for (const group of selected) for (const rule of group.rules) {
    const pattern = rule.path.split('*').map(s => s.replace(/[.*+?^$()|[\]\\{}]/g,'\\$&')).join('.*').replace(/\\\$$/,'$');
    if (new RegExp('^'+pattern).test(pathname) && (!winner || rule.path.length > winner.length || (rule.path.length === winner.length && rule.allow))) {
      winner = { allow:rule.allow, length:rule.path.length };
    }
  }
  return winner?.allow ?? true;
}
