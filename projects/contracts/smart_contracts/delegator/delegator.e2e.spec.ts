import { Config } from '@algorandfoundation/algokit-utils'
import { registerDebugEventHandlers } from '@algorandfoundation/algokit-utils-debug'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { Address } from 'algosdk'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { increaseBudgetBaseCost, increaseBudgetIncrementCost, XGovDelegatorSDK } from 'xgov-delegator-sdk'
import { DelegatorFactory } from '../artifacts/delegator/DelegatorClient'

describe('Delegator contract', () => {
  const localnet = algorandFixture()
  beforeAll(() => {
    Config.configure({
      debug: true,
      // traceAll: true,
    })
    registerDebugEventHandlers()
  })
  beforeEach(localnet.newScope)

  const deploy = async (account: Address) => {
    const factory = localnet.algorand.client.getTypedAppFactory(DelegatorFactory, {
      defaultSender: account,
    })

    const { appClient } = await factory.deploy({
      onUpdate: 'append',
      onSchemaBreak: 'append',
    })

    await localnet.algorand.account.ensureFundedFromEnvironment(appClient.appAddress, (10).algos())

    const sender = account
    const signer = localnet.algorand.account.getSigner(sender)

    return {
      client: appClient,
      sdk: new XGovDelegatorSDK({
        algorand: localnet.algorand,
        delegatorAppId: appClient.appId,
        writerAccount: { sender, signer },
        debug: false,
      }),
    }
  }

  describe('increaseBudget opcode cost', () => {
    for (let i = 0; i < 3; i++) {
      test(`It should cost ${increaseBudgetBaseCost + i * increaseBudgetIncrementCost} with itxns=${i}`, async () => {
        const { testAccount } = localnet.context
        const sender = testAccount.toString()
        const signer = testAccount.signer

        const { sdk } = await deploy(testAccount)

        const {
          simulateResponse: {
            txnGroups: [{ appBudgetConsumed }],
          },
        } = await sdk
          .writeClient!.newGroup()
          .increaseBudget({ sender, signer, args: { itxns: BigInt(i) }, extraFee: (i * 1000).microAlgo() })
          .simulate()

        expect(appBudgetConsumed).toBe(increaseBudgetBaseCost + i * increaseBudgetIncrementCost) // if this fails then update the new value in SDK/constants
      })
    }
  })

  describe('setCommitteeOracleAppId', () => {
    test(`Admin can set committee oracle app ID`, async () => {
      const { testAccount } = localnet.context
      const { sdk } = await deploy(testAccount)
      const appId = 12345n
      await sdk.setCommitteeOracleAppId({ appId })

      const { committeeOracleAppId } = await sdk.getGlobalState()
      expect(committeeOracleAppId).toBe(appId)
    })
  })
})
