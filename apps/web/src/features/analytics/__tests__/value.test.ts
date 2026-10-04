import { it, expect } from 'vitest'
import { computeValue } from '../value'

it('matches the guide formulas', () => {
  const r = computeValue({
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
  })
  expect(r.hoursSavedPerYear).toBeCloseTo(((200 * 35) / 60) * 12, 5)
  expect(r.labourValuePerYear).toBeCloseTo(r.hoursSavedPerYear * 60, 5)
  expect(r.fteFreed).toBeCloseTo(r.hoursSavedPerYear / 1600, 5)
  expect(r.cashReleased).toBeCloseTo((200 * 800 * 5) / 30, 5)
  expect(r.financingGainPerYear).toBeCloseTo(r.cashReleased * 0.06, 5)
  expect(r.errorsAvoidedPerYear).toBeCloseTo(200 * 12 * 0.08 * 0.75 * 400, 5)
  expect(r.valuePerYear).toBeCloseTo(r.labourValuePerYear + r.financingGainPerYear + r.errorsAvoidedPerYear, 5)
})
