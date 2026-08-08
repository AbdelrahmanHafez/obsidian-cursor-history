import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 180;
const SAMPLE_FPS = 30;
const NOTE_CHROME = { x: 63, y: 0, width: 55, height: 9 };
const EDITOR_BODY = { x: 70, y: 15, width: 150, height: 130 };
const MAX_CHROME_DRIFT = 0.006;
const MIN_BODY_CHANGE = 0.002;
const MIN_CHANGED_PAIRS = 8;
const MIN_TRANSLATION_RUN = 6;
const MAX_VERTICAL_SHIFT = 32;
const MIN_TRANSLATION_GAIN = 0.003;
const MIN_TRANSLATION_GAIN_RATIO = 0.25;
const MAX_TRANSLATION_ERROR = 0.035;

interface Transition {
	label: string;
	start: number;
	end: number;
	direction: -1 | 1;
}

const TRANSITIONS: Transition[] = [
	{ label: 'initial A -> B', start: 1.25, end: 1.95, direction: -1 },
	{ label: 'initial B -> C', start: 2.75, end: 3.45, direction: 1 },
	{ label: 'Back C -> B', start: 8.55, end: 9.15, direction: -1 },
	{ label: 'Back B -> A', start: 10.55, end: 11.15, direction: 1 },
	{ label: 'Forward A -> B', start: 12.55, end: 13.15, direction: -1 },
	{ label: 'Forward B -> C', start: 14.15, end: 14.75, direction: 1 },
];

describe('Cursor History demo viewport motion', () => {
	for (const transition of TRANSITIONS) {
		it(`${transition.label} uses sustained vertical scrolling`, () => {
			// Arrange
			const { framesFor } = createTestContext();
			const frames = framesFor(transition);

			// Act
			const chromeDrift = maximumRegionDrift(frames, NOTE_CHROME);
			const motion = analyzeVerticalMotion(frames, transition.direction);

			// Assert
			assert.ok(
				chromeDrift <= MAX_CHROME_DRIFT,
				`${transition.label} must keep note chrome stable; drift was ${formatScore(chromeDrift)}`
			);
			assert.ok(
				motion.changedPairs >= MIN_CHANGED_PAIRS,
				`${transition.label} must move the editor body across at least ${MIN_CHANGED_PAIRS} frame pairs; found ${motion.changedPairs}`
			);
			assert.ok(
				motion.longestTranslationRun >= MIN_TRANSLATION_RUN,
				`${transition.label} must use one sustained vertical translation, not a cut or blend; longest run was ${motion.longestTranslationRun} frame pairs (shifts: ${motion.shifts.join(', ')})`
			);
		});
	}

	it('does not mistake a text-doubling crossfade for viewport motion', () => {
		// Arrange
		const { frameAt } = createTestContext();
		const a = frameAt(0.75);
		const b = frameAt(2.25);
		const crossfade = blendFrames(a, b, 12);

		// Act
		const motion = analyzeVerticalMotion(crossfade, -1);

		// Assert
		assert.ok(
			motion.changedPairs >= MIN_CHANGED_PAIRS,
			'the synthetic crossfade must contain visible frame-to-frame changes'
		);
		assert.ok(
			motion.longestTranslationRun < MIN_TRANSLATION_RUN,
			'a text-doubling crossfade must not satisfy the vertical scrolling signal'
		);
	});

	function createTestContext({
		videoUrl = new URL('../docs/assets/cursor-history-demo.mp4', import.meta.url),
	} = {}) {
		const videoPath = fileURLToPath(videoUrl);
		const windows = new Map<string, Buffer[]>();
		const frames = new Map<number, Buffer>();

		return {
			framesFor(transition: Transition) {
				const key = `${transition.start}:${transition.end}`;
				const cached = windows.get(key);
				if (cached) return cached;

				const decoded = decodeWindow(videoPath, transition.start, transition.end);
				windows.set(key, decoded);
				return decoded;
			},
			frameAt(time: number) {
				const cached = frames.get(time);
				if (cached) return cached;

				const decoded = decodeFrame(videoPath, time);
				frames.set(time, decoded);
				return decoded;
			},
		};
	}
});

function decodeWindow(videoPath: string, start: number, end: number) {
	const result = spawnSync(
		'ffmpeg',
		[
			'-v',
			'error',
			'-ss',
			String(start),
			'-i',
			videoPath,
			'-t',
			String(end - start),
			'-vf',
			`fps=${SAMPLE_FPS},scale=${FRAME_WIDTH}:${FRAME_HEIGHT}:flags=area,format=gray`,
			'-f',
			'rawvideo',
			'-pix_fmt',
			'gray',
			'pipe:1',
		],
		{ maxBuffer: FRAME_WIDTH * FRAME_HEIGHT * SAMPLE_FPS * 2 }
	);

	assert.equal(
		result.status,
		0,
		`ffmpeg could not decode the motion window: ${result.stderr.toString().trim()}`
	);

	const frameSize = FRAME_WIDTH * FRAME_HEIGHT;
	assert.equal(result.stdout.length % frameSize, 0, 'motion window must contain complete frames');
	const frameCount = result.stdout.length / frameSize;
	assert.ok(frameCount >= 12, `expected at least 12 motion samples, received ${frameCount}`);

	return Array.from(
		{ length: frameCount },
		(_value, index) => result.stdout.subarray(index * frameSize, (index + 1) * frameSize)
	);
}

function decodeFrame(videoPath: string, time: number) {
	const result = spawnSync(
		'ffmpeg',
		[
			'-v',
			'error',
			'-ss',
			String(time),
			'-i',
			videoPath,
			'-frames:v',
			'1',
			'-vf',
			`scale=${FRAME_WIDTH}:${FRAME_HEIGHT}:flags=area,format=gray`,
			'-f',
			'rawvideo',
			'-pix_fmt',
			'gray',
			'pipe:1',
		],
		{ maxBuffer: FRAME_WIDTH * FRAME_HEIGHT * 2 }
	);

	assert.equal(
		result.status,
		0,
		`ffmpeg could not decode the demo frame: ${result.stderr.toString().trim()}`
	);
	assert.equal(result.stdout.length, FRAME_WIDTH * FRAME_HEIGHT);
	return result.stdout;
}

function maximumRegionDrift(frames: Buffer[], region: Bounds) {
	return Math.max(
		...frames.slice(1).map((frame) => regionDistance(frames[0], frame, region))
	);
}

function analyzeVerticalMotion(frames: Buffer[], direction: -1 | 1) {
	const fits = frames.slice(1).map((frame, index) =>
		fitVerticalTranslation(frames[index], frame, EDITOR_BODY)
	);
	const changedPairs = frames.slice(1).filter((frame, index) =>
		regionDistance(frames[index], frame, EDITOR_BODY) >= MIN_BODY_CHANGE
	).length;
	const directionalPairs = fits.map((fit) =>
		fit.shift * direction > 0 &&
		fit.gain >= MIN_TRANSLATION_GAIN &&
		fit.gainRatio >= MIN_TRANSLATION_GAIN_RATIO &&
		fit.error <= MAX_TRANSLATION_ERROR
	);

	return {
		changedPairs,
		longestTranslationRun: longestTrueRun(directionalPairs),
		shifts: fits.map(({ shift }) => shift),
	};
}

function fitVerticalTranslation(left: Buffer, right: Buffer, region: Bounds) {
	const zeroError = shiftedRegionDistance(left, right, region, 0);
	let shift = 0;
	let error = zeroError;

	for (let candidate = -MAX_VERTICAL_SHIFT; candidate <= MAX_VERTICAL_SHIFT; ++candidate) {
		if (candidate === 0) continue;
		const candidateError = shiftedRegionDistance(left, right, region, candidate);
		if (candidateError >= error) continue;
		shift = candidate;
		error = candidateError;
	}

	const gain = zeroError - error;
	return {
		shift,
		error,
		gain,
		gainRatio: gain / Math.max(zeroError, Number.EPSILON),
	};
}

function shiftedRegionDistance(
	left: Buffer,
	right: Buffer,
	region: Bounds,
	verticalShift: number
) {
	let difference = 0;
	let samples = 0;
	const startY = region.y + MAX_VERTICAL_SHIFT;
	const endY = region.y + region.height - MAX_VERTICAL_SHIFT;

	for (let y = startY; y < endY; y += 2) {
		for (let x = region.x; x < region.x + region.width; x += 2) {
			const leftOffset = y * FRAME_WIDTH + x;
			const rightOffset = (y + verticalShift) * FRAME_WIDTH + x;
			difference += Math.abs(left[leftOffset] - right[rightOffset]);
			samples++;
		}
	}

	return difference / (samples * 255);
}

function regionDistance(left: Buffer, right: Buffer, region: Bounds) {
	let difference = 0;

	for (let y = region.y; y < region.y + region.height; ++y) {
		const rowStart = y * FRAME_WIDTH + region.x;
		const rowEnd = rowStart + region.width;
		for (let offset = rowStart; offset < rowEnd; ++offset) {
			difference += Math.abs(left[offset] - right[offset]);
		}
	}

	return difference / (region.width * region.height * 255);
}

function blendFrames(start: Buffer, end: Buffer, frameCount: number) {
	return Array.from({ length: frameCount }, (_value, index) => {
		const progress = index / (frameCount - 1);
		const frame = Buffer.alloc(start.length);
		for (let offset = 0; offset < frame.length; ++offset) {
			frame[offset] = Math.round(start[offset] * (1 - progress) + end[offset] * progress);
		}
		return frame;
	});
}

function longestTrueRun(values: boolean[]) {
	let longest = 0;
	let current = 0;

	for (const value of values) {
		current = value ? current + 1 : 0;
		longest = Math.max(longest, current);
	}

	return longest;
}

function formatScore(value: number) {
	return value.toFixed(4);
}

interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}
