import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { XGovCommitteesOracleSDK, CommitteeOracleFactory, calculateCommitteeId } from "../src";
import { readFileSync } from "fs";

(async () => {
  const file = JSON.parse(readFileSync(process.argv[2], "utf-8"));

  const algorand = AlgorandClient.defaultLocalNet();
  const deployer = await algorand.account.fromEnvironment("DEPLOYER");

  const factory = algorand.client.getTypedAppFactory(CommitteeOracleFactory, {
    defaultSender: deployer.addr,
  });

  const { appId } = await factory.getAppClientByCreatorAndName({ creatorAddress: deployer.addr, appName: "CommitteeOracle" });

  console.log({ appId })

  const sdk = new XGovCommitteesOracleSDK({
    algorand,
    sender: { sender: deployer.addr, signer: deployer.signer },
    oracleAppId: appId,
  });

  await sdk.uploadCommitteeFile(file);

  // const xgc = await sdk.getCommittee(id);
  // console.log(xgc)
  // const og = xgc.map(({ account, votes }) => ({ address: account, votes }))
  // console.log(JSON.stringify(og, null, 2));
})();
