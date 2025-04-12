require('dotenv').config();
const {
  Ed25519PrivateKey,
  Account,
  Aptos,
  AptosConfig,
  Network,
} = require("@aptos-labs/ts-sdk");
const { OdysseyClient } = require("aptivate-odyssey-sdk");
const express = require("express");
const fs = require("fs");
const cors = require("cors");
const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "https://typea-frontend.vercel.app" // Update with your actual frontend URL
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })
);
app.use(express.json());

const odysseyClient = new OdysseyClient();
const configData = fs.readFileSync("./config.json", "utf-8");
const config = JSON.parse(configData);
const {
  network,
  collection,
  resource_account,
  storage,
  random_trait,
  reveal_required,
  base_token_uri,
} = config;
const private_key = process.env.PRIVATE_KEY;
const arweaveKey = process.env.ARWEAVE_KEY;

if (!private_key) {
  throw new Error("PRIVATE_KEY environment variable is required");
}
if (!arweaveKey && reveal_required) {
  throw new Error("ARWEAVE_KEY environment variable is required for NFT uploads");
}

const ERR_INTERNAL_SERVER_ERROR = "Internal Server Error";
const ERR_READING_ODYSSEY = "Error reading odyssey:";
const ERR_READING_STAGE = "Error reading stage:";
const ERR_READING_MINT = "Error reading mint txn:";
const ERR_UPDATING_TOKEN = "Error updating TOKEN:";

app.get("/api/get-odyssey", async (req, res) => {
  try {
    const aptos = getNetwork(network);
    const odysseyResource = await odysseyClient.getOdyssey(
      aptos,
      resource_account
    );
    if (odysseyResource) {
      res.json({ odyssey: odysseyResource });
    } else {
      res.json({ odyssey: null });
    }
  } catch (error) {
    console.error(ERR_READING_ODYSSEY, error.message);
    res.status(500).json({ error: ERR_INTERNAL_SERVER_ERROR });
  }
});

app.get("/api/get-stage", async (req, res) => {
  try {
    const aptos = getNetwork(network);
    const odysseyStage = await odysseyClient.getStage(aptos, resource_account);
    if (odysseyStage) {
      res.json({ stage: odysseyStage });
    } else {
      res.json({ stage: null });
    }
  } catch (error) {
    console.error(ERR_READING_STAGE, error.message);
    res.status(500).json({ error: ERR_INTERNAL_SERVER_ERROR });
  }
});

app.get("/api/allowlist-balance/:address", async (req, res) => {
  const { address } = req.params;
  try {
    const aptos = getNetwork(network);
    const userBalance = await odysseyClient.getAllowListBalance(
      aptos,
      resource_account,
      address
    );
    if (userBalance) {
      res.json({ balance: userBalance });
    } else {
      res.json({ balance: 0 });
    }
  } catch (error) {
    res.json({ balance: 0 });
  }
});

app.get("/api/publiclist-balance/:address", async (req, res) => {
  const { address } = req.params;
  try {
    const aptos = getNetwork(network);
    const userBalance = await odysseyClient.getPublicListBalance(
      aptos,
      resource_account,
      address
    );
    if (userBalance) {
      res.json({ balance: userBalance });
    } else {
      res.json({ balance: 0 });
    }
  } catch (error) {
    res.json({ balance: 0 });
  }
});

app.get("/api/get-mint-txn/:address/:mintQty", async ({ params: { address, mintQty } }, res) => {
  console.log('Mint request:', { address, mintQty });
  try {
    let token_uri = base_token_uri || "";
    if (reveal_required && !base_token_uri) {
      console.log('Checking assets in:', asset_dir);
      try {
        token_uri = await odysseyClient.uploadNFT(0, asset_dir, arweaveKey);
        console.log('Uploaded token_uri:', token_uri);
      } catch (error) {
        console.error(ERR_READING_MINT, 'Upload failed:', error.stack);
        return res.status(500).json({ error: ERR_INTERNAL_SERVER_ERROR });
      }
      if (token_uri) {
        odysseyClient.editConfigFile({ base_token_uri: token_uri });
        base_token_uri = token_uri;
      }
    }
    console.log('Generating mint payloads...');
    const payloads = await odysseyClient.getMintToPayloads(
      address,
      resource_account,
      mintQty,
      network,
      token_uri
    );
    console.log('Payloads:', payloads);
    res.json({ payloads: payloads || "" });
  } catch (error) {
    console.error(ERR_READING_MINT, 'Mint failed:', error.stack);
    res.status(500).json({ error: ERR_INTERNAL_SERVER_ERROR });
  }
});

app.get("/api/test-upload", async (req, res) => {
  try {
    const token_uri = await odysseyClient.uploadNFT(0, './assets', arweaveKey);
    console.log('Test upload token_uri:', token_uri);
    res.json({ token_uri });
  } catch (error) {
    console.error('Test upload failed:', error.stack);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.get("/api/get-network", async (req, res) => {
  try {
    res.json({ network: network });
  } catch (error) {
    console.error("Error retrieving network: ", error.message);
    res.status(500).json({ error: ERR_INTERNAL_SERVER_ERROR });
  }
});

app.post("/api/update-nft-data", async (req, res) => {
  try {
    const { token_no: tokenNo, token_address: tokenAddress } = req?.body;
    console.log("Update NFT data", tokenNo, tokenAddress);
    const resImage = await updateMetaDataImage(tokenNo, tokenAddress);

    odysseyClient.editNftDataFile(tokenNo, tokenAddress);
    res
      .status(200)
      .json({ message: "Successfully update nft data.", ...resImage });
  } catch (error) {
    console.error("Error add NFT to file: ", error.message);
    res.status(500).json({ error: ERR_INTERNAL_SERVER_ERROR });
  }
});

async function updateMetaDataImage(tokenNo, tokenAddress) {
  try {
    if (reveal_required) {
      return { simpleTxn: "" };
    } else {
      const aptos = getNetwork(network);
      const creator_account = getAccount(private_key);
      const txn = await odysseyClient.updateMetaDataImage(
        aptos,
        resource_account,
        creator_account,
        tokenNo,
        tokenAddress,
        asset_dir,
        arweaveKey,
        random_trait,
        collection_name,
        description
      );

      return { simpleTxn: txn || "" };
    }
  } catch (error) {
    console.error(ERR_UPDATING_TOKEN, error.message);
  }
}

function getNetwork(network) {
  let selectedNetwork = Network.DEVNET;
  const lowercaseNetwork = network.toLowerCase();
  switch (lowercaseNetwork) {
    case "testnet":
      selectedNetwork = Network.TESTNET;
      break;
    case "mainnet":
      selectedNetwork = Network.MAINNET;
      break;
    case "random":
      selectedNetwork = Network.RANDOMNET;
      break;
  }
  const APTOS_NETWORK = selectedNetwork;
  const aptosConfig = new AptosConfig({ network: APTOS_NETWORK });
  const aptos = new Aptos(aptosConfig);
  return aptos;
}

function getAccount(privateKey) {
  const account = Account.fromPrivateKey({
    privateKey: new Ed25519PrivateKey(privateKey),
    legacy: true,
  });
  return account;
}

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});