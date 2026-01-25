import { Config } from '@algorandfoundation/algokit-utils'
import { registerDebugEventHandlers } from '@algorandfoundation/algokit-utils-debug'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { Address } from 'algosdk'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { CommitteeOracleFactory } from '../artifacts/oracle/CommitteeOracleClient'
import { XGovCommitteesOracleSDK, calculateCommitteeId } from '../../../oracle-sdk'
import committee53M from '../../../common/committee-files/50000000-53000000.json'

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

  test('Uploads committee', async () => {
    const { testAccount } = localnet.context
    const { sdk } = await deploy(testAccount)

    const committeeId = calculateCommitteeId(JSON.stringify(committee53M))
    const result = await sdk.uploadCommitteeFile(committee53M)
    expect(result).toEqual(committeeId)    

    const storedCommittee = await sdk.getCommittee(committeeId)
    expect(storedCommittee).toBeDefined()
    expect(storedCommittee!.periodStart).toEqual(committee53M.periodStart)
    expect(storedCommittee!.periodEnd).toEqual(committee53M.periodEnd)
    expect(storedCommittee!.totalMembers).toEqual(committee53M.totalMembers)
    expect(storedCommittee!.totalVotes).toEqual(committee53M.totalVotes)
    expect(storedCommittee!.xGovs).toEqual(committee53M.xGovs)
  })
})
