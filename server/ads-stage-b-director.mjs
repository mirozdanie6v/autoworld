// Director report authorization must not inherit generic admin/API-key powers.
// Identity is the Telegram user pinned by the existing AWG access system
// AND separately allowlisted in a staging secret/configuration.
export function isAdsDirector(access,allowedIds=''){
  if(access?.authenticated!==true||access?.role!=='admin'
    ||access?.authType!=='telegram'||access?.apiKey===true
    ||!access?.admin)return false;
  const id=String(access?.user?.id||'');
  if(!/^[1-9][0-9]{0,19}$/.test(id)
    ||String(access.admin.telegramUserId||'')!==id)return false;
  const allowed=String(allowedIds||'').split(',').map(x=>x.trim())
    .filter(x=>/^[1-9][0-9]{0,19}$/.test(x));
  return allowed.length>0&&allowed.length<=5&&allowed.includes(id);
}
