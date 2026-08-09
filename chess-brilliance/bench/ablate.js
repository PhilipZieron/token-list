/**
 * Gate ablation: starting from a base configuration, report what each extra
 * restriction costs in recall and saves in (upper-bound) false positives.
 * The ratio "FP saved per positive lost" is what decides whether a rule earns
 * its place.
 */
import { buildFeatureTable } from './features.js';
import { DEFAULT_PARAMS } from '../src/core/classify.js';
import { score } from './tune.js';

const { rows, games } = buildFeatureTable(['chessigma-brilliant-benchmark.json']);

const BASE = { ...DEFAULT_PARAMS, maxSecondCp: 1200 };
const base = score(rows, games, BASE);
console.log(`base: recall ${base.tp}/100, extra detections ${base.fp} (${(base.fp / 100).toFixed(2)}/game)\n`);

const variants = [
  ['excludeInCheck=true', { excludeInCheck: true }],
  ['excludeRecapture=true', { excludeRecapture: true }],
  ['excludeKingMove=true', { excludeKingMove: true }],
  ['excludePromotion=true', { excludePromotion: true }],
  ['excludeBothMate=true', { excludeBothMate: true }],
  ['maxRank=1', { maxRank: 1 }],
  ['maxRank=2', { maxRank: 2 }],
  ['maxRank=3', { maxRank: 3 }],
  ['maxRank=5', { maxRank: 5 }],
  ['minPvSacrifice=100', { minPvSacrifice: 100 }],
  ['minPvSacrifice=200', { minPvSacrifice: 200 }],
  ['minPvSacrifice=300', { minPvSacrifice: 300 }],
  ['minSacGross=500', { minSacGross: 500 }],
  ['minSacNet=200', { minSacNet: 200 }],
  ['minSacNet=300', { minSacNet: 300 }],
  ['maxEpLoss=0.07', { maxEpLoss: 0.07 }],
  ['maxEpLoss=0.05', { maxEpLoss: 0.05 }],
  ['maxEpLoss=0.03', { maxEpLoss: 0.03 }],
  ['minPlayedCp=-30', { minPlayedCp: -30 }],
  ['minPlayedCp=0', { minPlayedCp: 0 }],
  ['maxSecondCp=900', { maxSecondCp: 900 }],
  ['maxSecondCp=700', { maxSecondCp: 700 }],
  ['maxSecondCp=500', { maxSecondCp: 500 }],
  ['requireShallowDisagreement', { requireShallowDisagreement: true }],
];

console.log('gate added                     recall   extra   Δrecall  ΔFP   FP saved per positive lost');
for (const [name, patch] of variants) {
  const s = score(rows, games, { ...BASE, ...patch });
  const dR = s.tp - base.tp;
  const dF = s.fp - base.fp;
  const ratio = dR < 0 ? (-dF / -dR).toFixed(1) : dF < 0 ? '∞ (free)' : '-';
  console.log(
    `${name.padEnd(30)} ${String(s.tp).padStart(3)}/100 ${String(s.fp).padStart(6)}  ${String(dR).padStart(6)} ${String(dF).padStart(5)}   ${ratio}`
  );
}
