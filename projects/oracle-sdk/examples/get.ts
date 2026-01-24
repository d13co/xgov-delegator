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


  const id = calculateCommitteeId(JSON.stringify(file));
  console.log({ id: Buffer.from(id).toString("base64") });

  const comm = (await sdk.getCommittee(id))!;
  console.log(JSON.stringify(comm, null, 2));
  for(const [key, value] of Object.entries(file)) {
    if (key === "xGovs") continue;
    if (!(key in comm)) continue;
    if (value !== comm[key as keyof typeof comm]) {
      console.error(`Mismatch on ${key}: expected ${value}, got ${comm[key as keyof typeof comm]}`);
    }
  }
  for(const { address, votes } of file.xGovs) {
    const member = comm.xGovs.find((x) => x.address === address);
    if (!member) {
      console.error(`Missing xGov: ${address}`);
      continue;
    }
    if (member.votes !== votes) {
      console.error(`Mismatch on votes for ${address}: expected ${votes}, got ${member.votes}`);
    }
  }
  console.log("Files match")
})();
