import express, { Request, Response } from 'express';
import {
    fetchMorphoMarketsAPI,
    FetchedMorphoMarket,
    FetchMarketsVariables,
} from './morphoMarkets';
import { ethers } from 'ethers';
import interestRateModelAbi from './interestRateModelAbi.json';
import dotenv from 'dotenv';

dotenv.config();

const provider = new ethers.providers.JsonRpcProvider("https://eth.llamarpc.com");
const INTEREST_RATE_MODEL_ADDRESS = "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC";

const app = express();
app.use(express.json());
const port = process.env.PORT || 3000;

export interface MarketOutputForCalculator {
    id: string;
    name: string;
    network: string;
    protocol: string;
    source: string;
    token_price: string | number;
    total_supplied: string | number;
    total_borrowed: string | number;
    fee_percentage: number;
    optimal_usage_ratio: number;
    reserve_factor: number;
    yearlySupplyTokens: string;
    rewardTokenDecimals: number;
    rewardTokenPriceUsd: string;
    rate_per_second: string;
}

function buildMarketParams(market: FetchedMorphoMarket) {
    return {
        loanToken: market.loanAsset.address,
        collateralToken: market.collateralAsset?.address || "0x0000000000000000000000000000000000000000",
        oracle: market.oracleAddress,
        irm: market.irmAddress,
        lltv: market.lltv.toString(),
    };
}

function buildMarketStruct(market: FetchedMorphoMarket) {
    return {
        totalSupplyAssets: market.state.supplyAssets.toString(),
        totalSupplyShares: market.state.supplyShares.toString(),
        totalBorrowAssets: market.state.borrowAssets.toString(),
        totalBorrowShares: market.state.borrowShares.toString(),
        lastUpdate: market.state.timestamp.toString(),
        fee: market.state.fee.toString(),
    };
}

async function getBorrowRateFromContract(market: FetchedMorphoMarket): Promise<string | null> {
    try {
        const contract = new ethers.Contract(INTEREST_RATE_MODEL_ADDRESS, interestRateModelAbi, provider);
        const marketParams = buildMarketParams(market);
        const marketStruct = buildMarketStruct(market);

        const rate: ethers.BigNumber = await contract.borrowRateView(
            marketParams,
            marketStruct
        );

        console.log("Contract response for market", market.uniqueKey, ":", {
            rate: rate.toString(),
            rateInEther: ethers.utils.formatEther(rate),
            ratePerYear: ethers.utils.formatEther(rate.mul(365 * 24 * 60 * 60))
        });

        return rate.toString();
    } catch (err) {
        console.error('borrowRateView failed for market', market.uniqueKey, err);
        return null;
    }
}

async function transformMarketData(
    market: FetchedMorphoMarket
): Promise<MarketOutputForCalculator> {
    const { loanAsset, collateralAsset, state, uniqueKey } = market;
    const network = loanAsset.chain?.network || 'Unknown';

    // Get reward data if available
    const reward = state.rewards && state.rewards.length > 0 ? state.rewards[0] : null;    

    // Get current borrow rate from on-chain contract
    const rate_per_second = await getBorrowRateFromContract(market) ?? "0";

    // Convert raw values to USD
    const loanAssetPrice = Number(loanAsset.priceUsd);
    const supplyAssetsInUsd = (Number(state.supplyAssets) / Math.pow(10, loanAsset.decimals)) * loanAssetPrice;
    const borrowAssetsInUsd = (Number(state.borrowAssets) / Math.pow(10, loanAsset.decimals)) * loanAssetPrice;

    // Handle null collateral asset case
    const marketName = collateralAsset 
        ? `${collateralAsset.symbol}/${loanAsset.symbol} Market`
        : `${loanAsset.symbol} Market`;

    return {
        id: uniqueKey,
        name: marketName,
        network: network,
        protocol: "Morpho",
        source: `Morpho ${network}`,
        token_price: loanAssetPrice,
        total_supplied: supplyAssetsInUsd,
        total_borrowed: borrowAssetsInUsd,
        fee_percentage: state.fee,
        optimal_usage_ratio: 0.9,
        reserve_factor: 0,
        yearlySupplyTokens: reward ? String(reward.yearlySupplyTokens) : "0",
        rewardTokenDecimals: reward ? reward.asset.decimals : 18,
        rewardTokenPriceUsd: reward ? String(reward.asset.priceUsd) : "0",
        rate_per_second: rate_per_second,
    };
}

app.get('/markets', async (req: Request, res: Response): Promise<void> => {
    try {
        const variables: FetchMarketsVariables = {};
        const { loanAssetAddress, first, orderBy } = req.query;

        if (loanAssetAddress && typeof loanAssetAddress === 'string') {
            variables.where = { loanAssetAddress_in: loanAssetAddress, whitelisted: true };
        } else {
            res.status(400).json({ error: "Missing or invalid required query parameter: loanAssetAddress" });
            return;
        }

        // Handle first parameter
        if (first && typeof first === 'string') {
            const firstNum = parseInt(first);
            if (!isNaN(firstNum) && firstNum > 0) {
                variables.first = firstNum;
            }
        } else {
            variables.first = 10; // Default value
        }

        // Handle orderBy parameter
        if (orderBy && typeof orderBy === 'string') {
            variables.orderBy = orderBy;
        }

        const fetchedMarkets = await fetchMorphoMarketsAPI(variables);
        
        // Transform the data to match the expected output format
        const transformedData = await Promise.all(
            fetchedMarkets.map(market => transformMarketData(market))
        );
        
        res.json(transformedData);

    } catch (error: any) {
        console.error('Error in /markets endpoint:', error.message || error, error.details || error.rawResponse || '');
        const statusCode = error.status || 500;
        const errorResponse = {
            error: error.message || 'An internal server error occurred',
            details: error.details || (error.rawResponse ? { rawResponse: error.rawResponse } : (error.message ? null : error))
        };
        res.status(statusCode).json(errorResponse);
    }
});

app.listen(port, () => {
    console.log(`API server listening at http://localhost:${port}/markets`);
    console.log(`Example usage: http://localhost:${port}/markets?loanAssetAddress=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&first=10&orderBy=SupplyApy`);
});