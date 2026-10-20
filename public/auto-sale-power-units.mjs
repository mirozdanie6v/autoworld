// Convert SAE mechanical horsepower (hp) to metric horsepower (PS, л.с.).
// powerHp is the legacy persisted field and ALWAYS contains metric PS.
export const HP_TO_PS = 1.013869665;
export const normalizePowerUnit = unit => unit === 'hp' ? 'hp' : 'ps';
export function toMetricHorsepower(value, unit = 'ps') {
  const power = Number(value);
  return Number.isFinite(power) && power >= 0 ? power * (normalizePowerUnit(unit) === 'hp' ? HP_TO_PS : 1) : 0;
}
export function fromMetricHorsepower(value, unit = 'ps') {
  const power = Number(value);
  return Number.isFinite(power) && power >= 0 ? power / (normalizePowerUnit(unit) === 'hp' ? HP_TO_PS : 1) : 0;
}
export function convertPowerInput(value, fromUnit = 'ps', toUnit = 'ps') {
  if (value === '' || value === null || value === undefined) return '';
  const power = Number(value);
  if (!Number.isFinite(power) || power < 0) return String(value);
  if (normalizePowerUnit(fromUnit) === normalizePowerUnit(toUnit)) return String(value);
  return String(Number(fromMetricHorsepower(toMetricHorsepower(power, fromUnit), toUnit).toFixed(6)));
}
// New quotes preserve exact user input. Legacy quotes only contain powerHp in PS.
export function quotePowerInput(quote = {}) {
  const raw = quote.powerInput;
  if (raw !== undefined && raw !== null && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0) return Number(raw);
  return Number(fromMetricHorsepower(quote.powerHp, quote.powerUnit).toFixed(6));
}
