import { Config } from '@algorandfoundation/algokit-utils'
import { registerDebugEventHandlers } from '@algorandfoundation/algokit-utils-debug'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { Address } from 'algosdk'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { CommitteeOracleFactory } from '../artifacts/oracle/CommitteeOracleClient'
import {
  XGovCommitteesOracleSDK,
  calculateCommitteeId,
  increaseBudgetBaseCost,
  increaseBudgetIncrementCost,
} from '../../../oracle-sdk'
import { committeesForTests } from './fixtures'

describe('Oracle contract', () => {
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
    const factory = localnet.algorand.client.getTypedAppFactory(CommitteeOracleFactory, {
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
      sdk: new XGovCommitteesOracleSDK({
        algorand: localnet.algorand,
        oracleAppId: appClient.appId,
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

  for (const [name, id, committeeFile] of committeesForTests) {
    test(`Uploads committee ${name}`, async () => {
      const { testAccount } = localnet.context
      const { sdk } = await deploy(testAccount)

      const committeeId = calculateCommitteeId(JSON.stringify(committeeFile))
      expect(committeeId).toEqual(new Uint8Array(Buffer.from(id, 'base64')))

      const result = await sdk.uploadCommitteeFile(committeeFile)
      expect(result).toEqual(committeeId)

      const storedCommittee = await sdk.getCommittee(committeeId)
      expect(storedCommittee).toBeDefined()
      expect(storedCommittee!.periodStart).toEqual(committeeFile.periodStart)
      expect(storedCommittee!.periodEnd).toEqual(committeeFile.periodEnd)
      expect(storedCommittee!.totalMembers).toEqual(committeeFile.totalMembers)
      expect(storedCommittee!.totalVotes).toEqual(committeeFile.totalVotes)
      expect(storedCommittee!.xGovs).toEqual(committeeFile.xGovs)
    })
  }
})
