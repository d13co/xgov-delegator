import { TestExecutionContext } from '@algorandfoundation/algorand-typescript-testing'
import { describe, expect, it } from 'vitest'
import { Delegator } from './contract.algo'

describe('Delegator contract', () => {
  const ctx = new TestExecutionContext()
  it('Logs the returned value when sayHello is called', () => {
    const contract = ctx.contract.create(Delegator)

    const result = contract.hello('Sally')

    expect(result).toBe('Hello, Sally')
  })
})
