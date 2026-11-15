#!/usr/bin/env node
/**
 * Writes test/fixtures/room.glb (box room 4 × 3 × 2.5 m) for the smoke test (REQ-090).
 * Usage: node tools/make-fixtures.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { makeGlb } from '../test/helpers/glb.js';
import { box } from '../test/helpers/meshes.js';

mkdirSync(new URL('../test/fixtures/', import.meta.url), { recursive: true });
writeFileSync(new URL('../test/fixtures/room.glb', import.meta.url), Buffer.from(makeGlb([box(4, 3, 2.5)])));
console.log('test/fixtures/room.glb written');
