import * as fs from 'fs';
import * as path from 'path';

const MORPHO_API_URL = "https://api.morpho.org/graphql";

export interface MarketLoanAsset {
  address: string;
  decimals: number;
  symbol: string;
  priceUsd: string; // USD price of the loan asset, typically 10^8 scaled
  chain: MarketChainInfo;
}

export interface MarketChainInfo {
  network: string;
}

export interface MarketCollateralAsset { 
  address: string;
  decimals: number;
  symbol: string;
  priceUsd: string; 
}

export interface RewardAssetInfo {
    decimals: number;
    priceUsd: string;
}

export interface MarketState {
  price: string; // Price of collateral in terms of loan asset OR an oracle price
  fee: number;
  supplyAssets: string;
  borrowAssets: string;
  supplyShares: string;
  borrowShares: string;
  timestamp: number;
  rewards?: MarketRewardsInfo[];
}

export interface MarketRewardsInfo {
    yearlySupplyTokens: string;
    asset: RewardAssetInfo;
}

export interface FetchedMorphoMarket {
    loanAsset: MarketLoanAsset;
    uniqueKey: string;
    collateralAsset: {
        address: string;
    };
    oracleAddress: string;
    irmAddress: string;
    lltv: string;
    state: MarketState;
}

interface MorphoGraphQLResponse {
    data: {
        markets: {
            items: FetchedMorphoMarket[];
        };
    };
}

// Updated GraphQL query based on user's stable version + enhanced rewards section
const NEW_MORPHO_MARKETS_QUERY = `
query Query($where: MarketFilters = { loanAssetAddress_in: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", whitelisted: true }, $first: Int = 4, $orderBy: MarketOrderBy) {
  markets(where: $where, first: $first, orderBy: $orderBy) {
    items {
      loanAsset {
        address
        decimals
        symbol
        priceUsd
        chain {
          network
        }
      }
      uniqueKey
      state {
        price
        fee
        supplyAssets
        borrowAssets
        supplyShares
        borrowShares
        timestamp
        rewards {
          yearlySupplyTokens
          asset {
            decimals
            priceUsd
          }
        }
      }
      collateralAsset {
        address
      }
      irmAddress
      lltv
      oracleAddress
    }
  }
}
`;

export type MarketFilters = {
    loanAssetAddress_in?: string;
    whitelisted?: boolean;
};

export type FetchMarketsVariables = {
    where?: MarketFilters;
    first?: number;
    orderBy?: string;
};

function saveRawResponse(responseText: string): void {
    try {
        const filePath = path.join(__dirname, 'raw_graphql_response.json');
        fs.writeFileSync(filePath, responseText, 'utf8');
        console.log(`Raw GraphQL response saved to ${filePath}`);
    } catch (fileError) {
        console.error('Failed to save raw GraphQL response:', fileError);
    }
}

function handleGraphQLError(response: Response, responseText: string): never {
    console.error(`HTTP error! status: ${response.status}`, responseText);
    try {
        const errorJson = JSON.parse(responseText);
        throw { 
            message: `HTTP error! status: ${response.status}`, 
            status: response.status,
            details: errorJson 
        };
    } catch (e) {
        throw { 
            message: `HTTP error! status: ${response.status}. Response not JSON: ${responseText}`,
            status: response.status,
            rawResponse: responseText
        };
    }
}

export async function fetchMorphoMarketsAPI(
    variables: FetchMarketsVariables
): Promise<FetchedMorphoMarket[]> {
    try {
        const body = {
            query: NEW_MORPHO_MARKETS_QUERY,
            variables: variables || {}
        };

        const response = await fetch(MORPHO_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(body),
        });

        const responseBodyText = await response.text();
        saveRawResponse(responseBodyText);

        if (!response.ok) {
            handleGraphQLError(response, responseBodyText);
        }

        const result: MorphoGraphQLResponse = JSON.parse(responseBodyText);
        
        if (result.data?.markets?.items) {
            return result.data.markets.items;
        }

        console.error('GraphQL query successful but did not return the expected data structure:', result);
        throw {
            message: 'GraphQL query successful but data not in expected structure',
            status: 500, 
            details: result
        };

    } catch (error: any) {
        console.error('Error in fetchMorphoMarketsAPI:', error.message || error);
        if (error.status && error.details) throw error; 
        if (error.status && error.rawResponse) throw error; 
        throw { 
            message: 'Failed to fetch or parse data from Morpho API.', 
            status: error.status || 500, 
            details: error.message || error 
        };
    }
}
