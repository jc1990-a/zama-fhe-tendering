// deploy/deploy.ts
import fs from "fs";
import path from "path";
import readline from "readline";
import { ethers as hardhatEthers } from "hardhat";
import { Wallet, JsonRpcProvider } from "ethers";

async function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) =>
    rl.question(prompt, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function main() {
  const privateKey = await ask("Enter the deployer private key (testnet only): ");
  let rpc = await ask("Enter the RPC URL (press Enter to use public Sepolia: https://sepolia.drpc.org): ");
  if (!rpc) rpc = "https://sepolia.drpc.org";

  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(privateKey, provider);

  console.log("Deployer account:", wallet.address);

  // ----------------- Deploy Tendering -----------------
  const TenderingFactory = await hardhatEthers.getContractFactory("Tendering", wallet);
  const Tendering = await TenderingFactory.deploy();
  await Tendering.waitForDeployment();

  const deployedAddress = (Tendering as any).target || (Tendering as any).address;
  console.log("Tendering contract deployed at:", deployedAddress);

  // ----------------- Write frontend config -----------------
  const frontendSrcDir = path.join(__dirname, "..", "frontend", "web", "src");
  if (!fs.existsSync(frontendSrcDir)) {
    console.warn("Frontend src directory not found, skipping config.json write:", frontendSrcDir);
  } else {
    // Write config.json
    const config = {
      network: rpc,
      contractAddress: deployedAddress,
      deployer: wallet.address,
    };
    fs.writeFileSync(path.join(frontendSrcDir, "config.json"), JSON.stringify(config, null, 2));
    console.log("Wrote frontend config: frontend/web/src/config.json");

    // ----------------- Copy ABI -----------------
    try {
      const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", "Tendering.sol", "Tendering.json");
      if (!fs.existsSync(artifactPath)) {
        throw new Error("ABI file not found. Did you compile the contract?");
      }

      const abiDir = path.join(frontendSrcDir, "abi");
      if (!fs.existsSync(abiDir)) fs.mkdirSync(abiDir, { recursive: true });

      const targetAbiPath = path.join(abiDir, "Tendering.json");
      fs.copyFileSync(artifactPath, targetAbiPath);
      console.log("Copied ABI to frontend/web/src/abi/Tendering.json");
    } catch (e) {
      console.warn(
        "Failed to copy ABI automatically. Please copy artifacts/.../Tendering.json manually to frontend/web/src/abi/Tendering.json",
        e
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
