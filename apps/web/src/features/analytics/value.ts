/** The business value calculator from section 5 of the hackathon guide. Every input is an editable assumption. */
export interface ValueInput {
  casesPerMonth: number
  minutesToday: number
  minutesWithAgent: number
  costPerHour: number
  errorRateToday: number
  sharePrevented: number
  lossPerError: number
  valuePerCase: number
  daysFaster: number
  costOfCapital: number
}

export interface ValueOutput {
  hoursSavedPerYear: number
  labourValuePerYear: number
  fteFreed: number
  cashReleased: number
  financingGainPerYear: number
  errorsAvoidedPerYear: number
  valuePerYear: number
}

export const DEFAULT_VALUE_INPUT: ValueInput = {
  casesPerMonth: 200,
  minutesToday: 45,
  minutesWithAgent: 10,
  costPerHour: 60,
  errorRateToday: 0.08,
  sharePrevented: 0.75,
  lossPerError: 400,
  valuePerCase: 800,
  daysFaster: 5,
  costOfCapital: 0.06,
}

export function computeValue(i: ValueInput): ValueOutput {
  const hoursSavedPerYear = ((i.casesPerMonth * (i.minutesToday - i.minutesWithAgent)) / 60) * 12
  const labourValuePerYear = hoursSavedPerYear * i.costPerHour
  const fteFreed = hoursSavedPerYear / 1600
  const cashReleased = (i.casesPerMonth * i.valuePerCase * i.daysFaster) / 30
  const financingGainPerYear = cashReleased * i.costOfCapital
  const errorsAvoidedPerYear = i.casesPerMonth * 12 * i.errorRateToday * i.sharePrevented * i.lossPerError
  return {
    hoursSavedPerYear,
    labourValuePerYear,
    fteFreed,
    cashReleased,
    financingGainPerYear,
    errorsAvoidedPerYear,
    valuePerYear: labourValuePerYear + financingGainPerYear + errorsAvoidedPerYear,
  }
}
