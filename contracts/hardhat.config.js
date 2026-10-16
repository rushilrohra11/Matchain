/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 1337,
    },
    localhost: {
      url: process.env.GANACHE_RPC_URL || 'http://127.0.0.1:8545',
      chainId: 1337,
    },
    ganache: {
      url: process.env.GANACHE_RPC_URL || 'http://127.0.0.1:8545',
      chainId: 1337,
    },
  },
};