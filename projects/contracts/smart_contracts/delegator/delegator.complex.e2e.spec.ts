import { Config } from '@algorandfoundation/algokit-utils'
import { registerDebugEventHandlers } from '@algorandfoundation/algokit-utils-debug'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { XGovDelegatorSDK } from 'xgov-delegator-sdk'
import { deployDelegatorFull } from '../common-tests'
import { Account, Address } from 'algosdk'
import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { calculateCommitteeId, XGovCommitteeFile, XGovCommitteesOracleSDK } from 'xgov-committees-oracle-sdk'
import { XGovProposalMockClient } from '../artifacts/xgov-proposal-mock/XGovProposalMockClient'

describe('Delegator complex e2e tests', () => {
  const localnet = algorandFixture()
  beforeAll(() => {
    Config.configure({
      debug: true,
      // traceAll: true,
    })
    registerDebugEventHandlers()
  })
  beforeEach(localnet.newScope)

  describe('Scenario 1', () => {
    let adminAccount: Address & TransactionSignerAccount & Account
    let committee: XGovCommitteeFile
    let delegatorAdminSDK: XGovDelegatorSDK
    let delegatorUserSDK: XGovDelegatorSDK | undefined
    let oracleSDK: XGovCommitteesOracleSDK
    let proposalAppClient: XGovProposalMockClient
    let registryAppClient: Awaited<ReturnType<typeof deployDelegatorFull>>['registryAppClient']
    let xGovs: (Address & Account & TransactionSignerAccount)[]

    beforeAll(async () => {
      await localnet.newScope()
      const { testAccount } = localnet.context
      adminAccount = testAccount
      ;({ committee, delegatorAdminSDK, delegatorUserSDK, oracleSDK, proposalAppClient, registryAppClient, xGovs } =
        await deployDelegatorFull(localnet, adminAccount, 3, 6))
    })

    test('It should syncCommitteeMetadata', async () => {
      const committeeId = calculateCommitteeId(JSON.stringify(committee))
      const committeeWithOffsets = await oracleSDK.fastGetCommittee(committeeId, { includeBoxOrder: true })
      const delegatedAccountsWithOffsetHint = committeeWithOffsets!.xGovBoxOrder!.map((xGovAddress, index) => 
        ({ account: xGovAddress, oracleSuperboxOffset: index }),
      )
      console.log({ delegatedAccountsWithOffsetHint})
      await delegatorAdminSDK.syncCommitteeMetadata({ committeeId, delegatedAccountsWithOffsetHint })
    })
  })
})
