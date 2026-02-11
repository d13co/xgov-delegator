import { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account'
import { AlgorandFixture } from '@algorandfoundation/algokit-utils/types/testing'
import { Address, Account } from 'algosdk'
import { CommitteeOracleFactory, XGovCommitteeFile, XGovCommitteesOracleSDK } from 'xgov-committees-oracle-sdk'
import { DelegatorFactory, XGovDelegatorSDK } from 'xgov-delegator-sdk'
import { XGovRegistryMockFactory } from './artifacts/xgov-registry-mock/XGovRegistryMockClient'
import committeeTemplate from '../../common/committee-files/template.json'
import { XGovProposalMockClient } from './artifacts/xgov-proposal-mock/XGovProposalMockClient'

export const deployOracle = async (localnet: AlgorandFixture, account: Address) => {
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

async function createCommittee(
  localnet: AlgorandFixture,
  registryAppId: bigint,
  totalMembers: number,
  votesPerMember: number,
): Promise<{ committee: XGovCommitteeFile; xGovs: (Address & Account & TransactionSignerAccount)[] }> {
  const xGovs = await Promise.all(
    Array.from({ length: totalMembers }, () => localnet.context.generateAccount({ initialFunds: (1).algos() })),
  )
  const committee: XGovCommitteeFile = {
    ...committeeTemplate,
    totalMembers,
    totalVotes: totalMembers * votesPerMember,
    registryId: Number(registryAppId),
    xGovs: xGovs.map((a) => ({
      address: a.toString(),
      votes: votesPerMember,
    })),
  }

  return { committee, xGovs }
}

export const deployRegistryAndOracle = async (localnet: AlgorandFixture, adminAccount: Address, numXGovs: number) => {
  const factory = localnet.algorand.client.getTypedAppFactory(XGovRegistryMockFactory, {
    defaultSender: adminAccount,
  })

  const { appClient: registryAppClient } = await factory.deploy({
    onUpdate: 'append',
    onSchemaBreak: 'append',
  })

  await localnet.algorand.account.ensureFundedFromEnvironment(registryAppClient.appAddress, (10).algos())

  const { return: proposalAppId } = await registryAppClient.send.createProposal({
    args: {},
    extraFee: (2000).microAlgo(),
  })
  const proposalAppClient = new XGovProposalMockClient({
    algorand: localnet.algorand,
    appId: proposalAppId!,
    defaultSender: adminAccount,
  })

  const { committee, xGovs } = await createCommittee(localnet, registryAppClient.appId, numXGovs, 1)

  const { sdk: oracleSDK } = await deployOracle(localnet, adminAccount)
  await oracleSDK.uploadCommitteeFile(committee)
  await oracleSDK.setXGovRegistryApp({ appId: registryAppClient.appId })

  return { registryAppClient, proposalAppClient, oracleSDK, committee, xGovs }
}

export const deployDelegatorFull = async (
  localnet: AlgorandFixture,
  adminAccount: Address,
  numXGovs: number,
  numSugDelegators: number,
) => {
  const { proposalAppClient, registryAppClient, oracleSDK, committee, xGovs } = await deployRegistryAndOracle(
    localnet,
    adminAccount,
    numXGovs,
  )
  const { adminSDK, userSDK } = await deployDelegatorSimple(localnet, adminAccount, xGovs[0])

  await adminSDK.setCommitteeOracleApp({ appId: oracleSDK.appId })

  const subDelegators = await Promise.all(
    Array.from({ length: numSugDelegators }, () => localnet.context.generateAccount({ initialFunds: (1).algos() })),
  )

  await Promise.all([
    adminSDK.addAccountAlgoHours({
      accountAlgohours: subDelegators.map((account) => ({ account: account.toString(), algoHours: 100n })),
      periodStart: committee.periodStart,
    }),
    adminSDK.addAccountAlgoHours({
      accountAlgohours: subDelegators.map((account) => ({ account: account.toString(), algoHours: 100n })),
      periodStart: committee.periodStart + 1_000_000,
    }),
    adminSDK.addAccountAlgoHours({
      accountAlgohours: subDelegators.map((account) => ({ account: account.toString(), algoHours: 100n })),
      periodStart: committee.periodStart + 2_000_000,
    }),
  ])

  await Promise.all(
    Array.from({ length: 3 }, (_, idx) =>
      adminSDK.updateAlgoHourPeriodFinality({
        periodStart: committee.periodStart + idx * 1_000_000,
        final: true,
        totalAlgohours: BigInt(subDelegators.length * 100),
      }),
    ),
  )

  return {
    delegatorAdminSDK: adminSDK,
    delegatorUserSDK: userSDK,
    oracleSDK,
    registryAppClient,
    proposalAppClient,
    committee,
    xGovs,
    subDelegators,
  }
}

export const deployDelegatorSimple = async (
  localnet: AlgorandFixture,
  adminAccount: Address,
  userAccount?: Address,
) => {
  const factory = localnet.algorand.client.getTypedAppFactory(DelegatorFactory, {
    defaultSender: adminAccount,
  })

  const { appClient } = await factory.deploy({
    onUpdate: 'append',
    onSchemaBreak: 'append',
  })

  await localnet.algorand.account.ensureFundedFromEnvironment(appClient.appAddress, (10).algos())

  const sender = adminAccount
  const signer = localnet.algorand.account.getSigner(sender)

  const retVal: { client: typeof appClient; adminSDK: XGovDelegatorSDK; userSDK?: XGovDelegatorSDK } = {
    client: appClient,
    adminSDK: new XGovDelegatorSDK({
      algorand: localnet.algorand,
      delegatorAppId: appClient.appId,
      writerAccount: { sender, signer },
      debug: false,
    }),
  }

  if (userAccount) {
    const userSigner = localnet.algorand.account.getSigner(userAccount)
    retVal.userSDK = new XGovDelegatorSDK({
      algorand: localnet.algorand,
      delegatorAppId: appClient.appId,
      writerAccount: { sender: userAccount, signer: userSigner },
      debug: false,
    })
  }

  return retVal
}
