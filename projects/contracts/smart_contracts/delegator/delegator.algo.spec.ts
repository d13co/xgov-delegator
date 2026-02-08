import { Application, Bytes } from '@algorandfoundation/algorand-typescript'
import { TestExecutionContext } from '@algorandfoundation/algorand-typescript-testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { expectArc65Error } from '../base/common-tests'
import { errUnauthorized } from '../base/errors.algo'
import { Delegator } from './delegator.algo'

// Expose subroutines for testing
class DelegatorTests extends Delegator {}

describe('Delegator tests', () => {
  const ctx = new TestExecutionContext()

  beforeEach(() => ctx.reset())

  describe('setCommitteeOracleAppId', () => {
    it('admin can change committeeOracleApp', () => {
      const contract = ctx.contract.create(DelegatorTests)
      const expected = Application(1)
      contract.setCommitteeOracleApp(expected)

      const [actual, found] = ctx.ledger.getGlobalState(contract, Bytes('committeeOracleApp'))
      expect(found).toBe(true)
      expect(actual!.value).toEqual(expected)
    })

    it('non admin cannot change committeeOracleAppId', () => {
      const contract = ctx.contract.create(DelegatorTests)
      ctx.defaultSender = ctx.any.account() // change sender to non-creator

      expectArc65Error(ctx, () => contract.setCommitteeOracleApp(Application(1)), errUnauthorized)
    })
  })

  // describe('addAccountAlgoHours', () => {
  //   const periodStart = Uint64(1_000_000);
  //   it('admin can add account algo hours', () => {
  //     const contract = ctx.contract.create(DelegatorTests)
  //     const account = ctx.any.account()
  //     const hours = Uint64(100)
  //     const algohourInputs: AccountAlgohourInput[] = [{ account, hours }]
  //     contract.addAccountAlgoHours(periodStart, algohourInputs)
  //     // Error: unsupported type Account
  //     //  ❯ getMaxLengthOfStaticContentType ../../node_modules/.pnpm/@algorandfoundation+algorand-typescript-testing@1.1.0_tslib@2.8.1/node_modules/@algorandfoundation/src/impl/encoded-types/utils.ts:83:13
  //     //  ❯ getMaxBytesLengthForObjectType ../../node_modules/.pnpm/@algorandfoundation+algorand-typescript-testing@1.1.0_tslib@2.8.1/node_modules/@algorandfoundation/src/impl/encoded-types/utils.ts:43:17
  //     //  ❯ getMaxLengthOfStaticContentType ../../node_modules/.pnpm/@algorandfoundation+algorand-typescript-testing@1.1.0_tslib@2.8.1/node_modules/@algorandfoundation/src/impl/encoded-types/utils.ts:81:14
  //     //  ❯ decode ../../node_modules/.pnpm/@algorandfoundation+algorand-typescript-testing@1.1.0_tslib@2.8.1/node_modules/@algorandfoundation/src/impl/encoded-types/encoded-types.ts:1093:23
  //     //  ❯ DynamicArray.get items [as items] ../../node_modules/.pnpm/@algorandfoundation+algorand-typescript-testing@1.1.0_tslib@2.8.1/node_modules/@algorandfoundation/src/impl/encoded-types/encoded-types.ts:581:21
  //     //  ❯ DynamicArray.get native [as native] ../../node_modules/.pnpm/@algorandfoundation+algorand-typescript-testing@1.1.0_tslib@2.8.1/node_modules/@algorandfoundation/src/impl/encoded-types/encoded-types.ts:600:17
  //     //  ❯ Object.get ../../node_modules/.pnpm/@algorandfoundation+algorand-typescript-testing@1.1.0_tslib@2.8.1/node_modules/@algorandfoundation/src/impl/encoded-types/array-proxy.ts:23:20
  //     //  ❯ arrayFromBytes ../../node_modules/.pnpm/@algorandfoundation+algorand-typescript-testing@1.1.0_tslib@2.8.1/node_modules/@algorandfoundation/src/impl/encoded-types/encoded-types.ts:1393:63
  //     //  ❯ Module.clone ../../node_modules/.pnpm/@algorandfoundation+algorand-typescript-testing@1.1.0_tslib@2.8.1/node_modules/@algorandfoundation/src/impl/clone.ts:11:10
  //   }
  // })
})
