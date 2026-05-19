import leaderboardMetrics from './routerMetrics/leaderboard.json';
import categoryScores from './routerMetrics/category_scores.json';
import contactInfoData from './contactInfo.json';
import datasetInfoData from './datasetInfo.json';
import routersMetadataJson from './routers.json';
import { Router, DatasetInfo, ContactInfo } from '../types';

const toRouterId = (value: string): string => value.toLowerCase().replace(/[_\s]/g, '-');

const roundToOneDecimal = (value: number): number => Math.round(value * 10) / 10;
const roundNullableToOneDecimal = (value: number | null): number | null =>
  value === null ? null : roundToOneDecimal(value);

export const contactInfo: ContactInfo = contactInfoData as ContactInfo;
export const datasetInfo: DatasetInfo = datasetInfoData as DatasetInfo;

const calculateAverageScore = (metrics: {
  arenaScore: number;
  optimalSelectionScore: number | null;
  optimalCostScore: number | null;
  optimalAccScore: number | null;
  robustnessScore: number | null;
  latencyScore: number | null;
}): number => {
  const scores: number[] = [metrics.arenaScore];
  if (metrics.optimalSelectionScore !== null) scores.push(metrics.optimalSelectionScore);
  if (metrics.optimalCostScore !== null) scores.push(metrics.optimalCostScore);
  if (metrics.optimalAccScore !== null) scores.push(metrics.optimalAccScore);
  if (metrics.robustnessScore !== null) scores.push(metrics.robustnessScore);
  if (metrics.latencyScore !== null) scores.push(metrics.latencyScore);
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
};

type LeaderboardMetricRecord = {
  'Router Name': string;
  'Arena Score': number;
  'Optimal Selection Score': number | null;
  'Optimal Cost Score': number | null;
  'Optimal Acc. Score': number | null;
  'Robustness Score': number | null;
  'Latency Score': number | null;
  Accuracy: number;
  'Cost per 1k': number;
};

type RouterMetadataEntry = {
  name: string;
  type: 'open-source' | 'closed-source';
  description: string;
  affiliation: string;
  modelPool: string[];
  paperUrl?: string;
  githubUrl?: string;
  websiteUrl?: string;
  huggingfaceUrl?: string;
};

export type DifficultyLevel = 'easy' | 'medium' | 'hard' | 'all';
export type CompareMetric = 'accuracy' | 'robustness' | 'cost';

type DifficultyMetricMap = Record<DifficultyLevel, Record<CompareMetric, number>>;

type CompareSubcategory = {
  metrics: DifficultyMetricMap;
};

type CompareCategory = {
  metrics: DifficultyMetricMap;
  subcategories?: Record<string, CompareSubcategory>;
};

export type RouterCompareEntry = {
  metrics: DifficultyMetricMap;
  categories: Record<string, CompareCategory>;
};

const routerMetadata: Record<string, RouterMetadataEntry> = routersMetadataJson as Record<
  string,
  RouterMetadataEntry
>;
const rawRouterData: LeaderboardMetricRecord[] = leaderboardMetrics;
const rawCategoryScores = categoryScores as Record<string, RouterCompareEntry>;
const normalizedCategoryScores = Object.entries(rawCategoryScores).reduce<Record<string, RouterCompareEntry>>(
  (acc, [key, value]) => {
    acc[toRouterId(key)] = value;
    return acc;
  },
  {}
);

const templateEntry = rawCategoryScores[Object.keys(rawCategoryScores)[0]];
const categoryBlueprints = Object.entries(templateEntry.categories).map(([categoryName, category]) => ({
  name: categoryName,
  subcategories: category.subcategories ? Object.keys(category.subcategories) : [],
}));

const clamp = (value: number, min = 0, max = 100): number => Math.min(Math.max(value, min), max);
const COST_MIN = 0.0044;
const COST_MAX = 200;

export const computeCostScore = (costPer1k: number): number => {
  const numerator = Math.log2(COST_MAX) - Math.log2(Math.max(costPer1k, COST_MIN));
  const denominator = Math.log2(COST_MAX) - Math.log2(COST_MIN);
  if (denominator === 0) return 0;
  return clamp((numerator / denominator) * 100);
};

const createDifficultyMetrics = (
  baseAccuracy: number,
  costScore: number,
  offset: number
): DifficultyMetricMap => {
  const accuracyShift = offset * 0.6;
  const easyAcc = clamp(baseAccuracy + 6 - accuracyShift);
  const mediumAcc = clamp(baseAccuracy - 2 - accuracyShift * 0.5);
  const hardAcc = clamp(baseAccuracy - 10 - accuracyShift * 0.25);
  const allAcc = clamp(baseAccuracy - accuracyShift * 0.25);
  const baseRobust = clamp(78 + baseAccuracy * 0.25 - offset * 0.4);
  const easyRobust = clamp(baseRobust + 4);
  const mediumRobust = clamp(baseRobust + 1.5);
  const hardRobust = clamp(baseRobust - 1.5);
  const adjustedCost = clamp(costScore - offset * 0.5);

  return {
    easy: { accuracy: easyAcc, robustness: easyRobust, cost: adjustedCost },
    medium: { accuracy: mediumAcc, robustness: mediumRobust, cost: clamp(adjustedCost - 1) },
    hard: { accuracy: hardAcc, robustness: hardRobust, cost: clamp(adjustedCost - 2) },
    all: { accuracy: allAcc, robustness: mediumRobust, cost: adjustedCost },
  };
};

const buildCompareEntry = (router: Router): RouterCompareEntry => {
  const accuracy = router.metrics.accuracy;
  const costScore = computeCostScore(router.metrics.costPer1k);
  const entry: RouterCompareEntry = {
    metrics: createDifficultyMetrics(accuracy, costScore, 0),
    categories: {},
  };

  categoryBlueprints.forEach((blueprint, idx) => {
    entry.categories[blueprint.name] = {
      metrics: createDifficultyMetrics(accuracy, costScore, idx * 1.8),
      subcategories:
        blueprint.subcategories.length > 0
          ? blueprint.subcategories.reduce((acc, subName, subIdx) => {
              acc[subName] = {
                metrics: createDifficultyMetrics(accuracy - subIdx, costScore + subIdx * 0.5, idx + subIdx),
              };
              return acc;
            }, {} as Record<string, CompareSubcategory>)
          : undefined,
    };
  });

  return entry;
};

const routerCategoryScores: Record<string, RouterCompareEntry> = { ...normalizedCategoryScores };
export const compareMetrics: CompareMetric[] = ['accuracy', 'robustness', 'cost'];
export const compareDifficulties: DifficultyLevel[] = ['easy', 'medium', 'hard', 'all'];

const metadataById: Record<string, RouterMetadataEntry> = {};
Object.entries(routerMetadata).forEach(([key, value]) => {
  metadataById[toRouterId(key)] = value;
});

const routersWithRanks = rawRouterData.map(router => {
  const id = toRouterId(router['Router Name']);
  const metadata = metadataById[id] || {
    name: router['Router Name'],
    type: 'open-source' as const,
    description: `Router: ${router['Router Name']}`,
    affiliation: 'Unknown',
    modelPool: [],
  };

  const metrics = {
    arenaScore: roundToOneDecimal(router['Arena Score']),
    optimalSelectionScore: roundNullableToOneDecimal(router['Optimal Selection Score']),
    optimalCostScore: roundNullableToOneDecimal(router['Optimal Cost Score']),
    optimalAccScore: roundNullableToOneDecimal(router['Optimal Acc. Score']),
    robustnessScore: roundNullableToOneDecimal(router['Robustness Score']),
    latencyScore: roundNullableToOneDecimal(router['Latency Score']),
    accuracy: router['Accuracy'],
    costPer1k: router['Cost per 1k'],
    overallRank: 0,
  };

  return {
    id,
    ...metadata,
    metrics,
    _averageScore: calculateAverageScore(metrics),
  };
});

routersWithRanks.sort((a, b) => b.metrics.arenaScore - a.metrics.arenaScore);
routersWithRanks.forEach((router, index) => {
  router.metrics.overallRank = index + 1;
});

export const routers: Router[] = routersWithRanks.map(({ _averageScore, ...router }) => router);

export const routerMetricsById: Record<string, Router['metrics']> = routers.reduce((acc, router) => {
  acc[router.id] = router.metrics;
  return acc;
}, {} as Record<string, Router['metrics']>);

routers.forEach(router => {
  if (!routerCategoryScores[router.id]) {
    routerCategoryScores[router.id] = buildCompareEntry(router);
  }
});

export { routerCategoryScores };
export const compareRouterNames = Object.keys(routerCategoryScores);

export const routerIdToName: Record<string, string> = routers.reduce((acc, router) => {
  acc[router.id] = router.name;
  return acc;
}, {} as Record<string, string>);

const formatRouterId = (id: string): string =>
  id
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export const compareRouterOptions = compareRouterNames.map(id => ({
  id,
  name: routerIdToName[id] || metadataById[id]?.name || formatRouterId(id),
}));
