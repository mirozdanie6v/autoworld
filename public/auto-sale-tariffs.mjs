// Canonical preliminary tariffs, versioned to preserve previously agreed quotes.
// The company's $500 service is INCLUDED in the legalization package.
import {AWG_GEORGIA_TARIFF_VERSION} from './auto-sale-georgia-quote.mjs';
export const AWG_TARIFF_VERSION='2026-10-20';
export const AWG_COMPANY_SERVICE_USD=500;
export const AWG_CRYPTO_RATE=0.035;
export const AWG_US_LOGISTICS={min:3100,mid:3350,max:3600};

export function awgTariff(origin,ageCategory){
  if(!['США','Грузия'].includes(origin)||!['under3','3to5'].includes(ageCategory))return null;
  const packageUsd=origin==='США'&&ageCategory==='under3'?6500:5000;
  return {
    tariffVersion:origin==='Грузия'?AWG_GEORGIA_TARIFF_VERSION:AWG_TARIFF_VERSION,ageCategory,
    legalization:origin==='Грузия'?4000:packageUsd-AWG_COMPANY_SERVICE_USD,
    service:origin==='Грузия'?1000:AWG_COMPANY_SERVICE_USD,
    ocean:origin==='США'?AWG_US_LOGISTICS.mid:0,
    deliveryRange:origin==='США'?'2,5–3,5 месяца':'5–10 дней'
  };
}

const safe=v=>Math.max(0,Number(v)||0);
export function awgCryptoFee({origin,lot,auction,inland}={}){
  if(origin!=='США')return 0;
  // PRELIMINARY basis: lot + auction charges + inland transport to US port.
  // The manager must explicitly confirm the base before sending a quote.
  return Math.round((safe(lot)+safe(auction)+safe(inland))*AWG_CRYPTO_RATE);
}
export function awgPackageUsd(q={}){
  return safe(q.legalization)+safe(q.service);
}
export function awgPendingItems(q={}){
  if(q.tariffVersion!==AWG_TARIFF_VERSION)return [];
  const pending=[];
  if(!['under3','3to5'].includes(q.ageCategory))pending.push('Возраст для тарифной схемы');
  if(!q.customsConfirmed)pending.push('Таможня');
  if(!q.recyclingConfirmed)pending.push('Утильсбор');
  if(q.origin==='США'&&!q.cryptoBaseConfirmed)pending.push('База криптоперевода 3,5%');
  if(q.origin==='США'&&!q.repairReviewed)pending.push('Ремонт / запчасти');
  return pending;
}
