import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 180;
const SAMPLE_FPS = 12;
const FRAME_SIZE = FRAME_WIDTH * FRAME_HEIGHT * 3;
const NOTE_CHROME = { x: 63, y: 0, width: 55, height: 9 };
const EDITOR_BODY = { x: 70, y: 15, width: 220, height: 130 };
const KEYCASTR_ACTION_ZONE = { x: 154, y: 154, width: 42, height: 15 };
const MOTION_THRESHOLD = 0.002;
const MAX_MOTION_GAP_FRAMES = 2;
const KEYCASTR_LIGHT_LUMA = 125;
const MIN_ACTION_GLYPH_PIXELS = 20;
const SAME_NOTE_TOLERANCE = 0.003;
const DIFFERENT_NOTE_THRESHOLD = 0.01;
const DISTINCT_STOP_THRESHOLD = 0.015;
const MIN_NAVIGATION_ACTIONS = 6;
const EXPECTED_DURATION_FRAMES = SAMPLE_FPS * 12;

const MEDIA_ASSETS = [
	{
		label: 'MP4',
		url: new URL('../docs/assets/cursor-history-demo.mp4', import.meta.url),
	},
	{
		label: 'GIF',
		url: new URL('../docs/assets/cursor-history-demo.gif', import.meta.url),
	},
] as const;

interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface Transition {
	startPair: number;
	endPair: number;
}

interface FrameWindow {
	startFrame: number;
	endFrame: number;
}

describe('Cursor History live screencast', () => {
	for (const media of MEDIA_ASSETS) {
		it(`${media.label} shows cursor stops within a note and across notes`, () => {
			// Arrange
			const { analyze } = createTestContext({ mediaUrl: media.url });

			// Act
			const { frameCount, transitions, stableStates } = analyze();
			const adjacentStops = stableStates.slice(1).map((state, index) => ({
				bodyDistance: regionDistance(stableStates[index], state, EDITOR_BODY),
				noteDistance: regionDistance(stableStates[index], state, NOTE_CHROME),
			}));
			const sameNoteStops = adjacentStops.filter(
				({ bodyDistance, noteDistance }) =>
					noteDistance <= SAME_NOTE_TOLERANCE &&
					bodyDistance >= DISTINCT_STOP_THRESHOLD
			);
			const crossNoteStops = adjacentStops.filter(
				({ noteDistance }) => noteDistance >= DIFFERENT_NOTE_THRESHOLD
			);

			// Assert
			assert.equal(frameCount, EXPECTED_DURATION_FRAMES);
			assert.ok(
				transitions.length >= MIN_NAVIGATION_ACTIONS,
				`${media.label} must show several history actions; detected ${formatTransitions(transitions)}`
			);
			assert.ok(
				sameNoteStops.length >= 3,
				`${media.label} must visibly demonstrate at least three cursor stops in the same note`
			);
			assert.ok(
				crossNoteStops.length >= 1,
				`${media.label} must visibly demonstrate cursor history across notes`
			);
		});

		it(`${media.label} pairs every navigation action with its live keystroke`, () => {
			// Arrange
			const { analyze } = createTestContext({ mediaUrl: media.url });

			// Act
			const { actionWindows, transitions } = analyze();

			// Assert
			assert.equal(
				actionWindows.length,
				transitions.length,
				`${media.label} must show one live KeyCastr action for every viewport transition`
			);

			for (const [index, transition] of transitions.entries()) {
				const firstChangedFrame = transition.startPair + 1;
				const action = actionWindows[index];

				assert.ok(
					action.startFrame <= firstChangedFrame &&
						action.endFrame >= firstChangedFrame,
					`${media.label} navigation ${index + 1} must show its live keystroke at the first viewport change (${formatTime(firstChangedFrame)})`
				);
			}
		});
	}

	const analyses = new Map<string, ReturnType<typeof analyzeFrames>>();

	function createTestContext({ mediaUrl }: { mediaUrl: URL }) {
		const mediaPath = fileURLToPath(mediaUrl);

		return {
			analyze() {
				const cached = analyses.get(mediaPath);
				if (cached) return cached;

				const analysis = analyzeFrames(decodeFrames(mediaPath));
				analyses.set(mediaPath, analysis);
				return analysis;
			},
		};
	}
});

function decodeFrames(mediaPath: string) {
	const result = spawnSync(
		'ffmpeg',
		[
			'-v',
			'error',
			'-i',
			mediaPath,
			'-vf',
			`fps=${SAMPLE_FPS},scale=${FRAME_WIDTH}:${FRAME_HEIGHT}:flags=area`,
			'-f',
			'rawvideo',
			'-pix_fmt',
			'rgb24',
			'pipe:1',
		],
		{ maxBuffer: FRAME_SIZE * SAMPLE_FPS * 30 }
	);

	const error = result.error?.message ?? result.stderr.toString().trim();
	assert.equal(result.status, 0, `ffmpeg could not decode ${mediaPath}: ${error}`);
	assert.equal(result.stdout.length % FRAME_SIZE, 0, 'demo must decode to complete frames');
	assert.ok(
		result.stdout.length >= FRAME_SIZE * SAMPLE_FPS * 5,
		'demo must contain enough frames to show all six history actions'
	);

	return Array.from(
		{ length: result.stdout.length / FRAME_SIZE },
		(_value, index) => result.stdout.subarray(index * FRAME_SIZE, (index + 1) * FRAME_SIZE)
	);
}

function analyzeFrames(frames: Buffer[]) {
	const motionScores = frames.slice(1).map((frame, index) =>
		regionDistance(frames[index], frame, EDITOR_BODY)
	);
	const motionPairs = motionScores
		.map((score, pair) => ({ pair, score }))
		.filter(({ score }) => score >= MOTION_THRESHOLD)
		.map(({ pair }) => pair);
	const transitions = groupMotionPairs(motionPairs);
	const actionWindows = groupVisibleFrames(frames.map(hasVisibleKeyCastrAction));

	return {
		actionWindows,
		frameCount: frames.length,
		stableStates: sampleStableStates(frames, transitions),
		transitions,
	};
}

function groupVisibleFrames(visibleFrames: boolean[]) {
	const windows: FrameWindow[] = [];

	for (const [frame, visible] of visibleFrames.entries()) {
		if (!visible) continue;
		const current = windows.at(-1);
		if (!current || frame > current.endFrame + 1) {
			windows.push({ startFrame: frame, endFrame: frame });
			continue;
		}
		current.endFrame = frame;
	}

	return windows;
}

function groupMotionPairs(motionPairs: number[]) {
	const transitions: Transition[] = [];

	for (const pair of motionPairs) {
		const current = transitions.at(-1);
		if (!current || pair - current.endPair > MAX_MOTION_GAP_FRAMES + 1) {
			transitions.push({ startPair: pair, endPair: pair });
			continue;
		}
		current.endPair = pair;
	}

	return transitions;
}

function sampleStableStates(frames: Buffer[], transitions: Transition[]) {
	if (transitions.length === 0) return [frames[Math.floor(frames.length / 2)]];

	const intervals = [
		{ start: 0, end: transitions[0].startPair },
		...transitions.slice(0, -1).map((transition, index) => ({
			start: transition.endPair + 1,
			end: transitions[index + 1].startPair,
		})),
		{
			start: transitions.at(-1)!.endPair + 1,
			end: frames.length - 1,
		},
	];

	return intervals.map(({ start, end }) => frames[Math.floor((start + end) / 2)]);
}

function hasVisibleKeyCastrAction(frame: Buffer) {
	let lightPixels = 0;

	forEachPixel(frame, KEYCASTR_ACTION_ZONE, (_red, _green, _blue, luma) => {
		if (luma >= KEYCASTR_LIGHT_LUMA) lightPixels++;
	});

	return lightPixels >= MIN_ACTION_GLYPH_PIXELS;
}

function regionDistance(left: Buffer, right: Buffer, region: Bounds) {
	let difference = 0;

	for (let y = region.y; y < region.y + region.height; ++y) {
		for (let x = region.x; x < region.x + region.width; ++x) {
			const offset = (y * FRAME_WIDTH + x) * 3;
			difference += Math.abs(luma(left, offset) - luma(right, offset));
		}
	}

	return difference / (region.width * region.height * 255);
}

function forEachPixel(
	frame: Buffer,
	region: Bounds,
	callback: (red: number, green: number, blue: number, luma: number) => void
) {
	for (let y = region.y; y < region.y + region.height; ++y) {
		for (let x = region.x; x < region.x + region.width; ++x) {
			const offset = (y * FRAME_WIDTH + x) * 3;
			const red = frame[offset];
			const green = frame[offset + 1];
			const blue = frame[offset + 2];
			callback(red, green, blue, luma(frame, offset));
		}
	}
}

function luma(frame: Buffer, offset: number) {
	return (
		frame[offset] * 54 + frame[offset + 1] * 183 + frame[offset + 2] * 19
	) >> 8;
}

function formatTransitions(transitions: Transition[]) {
	if (transitions.length === 0) return 'none';
	return transitions
		.map(({ startPair, endPair }) =>
			`${formatTime(startPair)}-${formatTime(endPair + 1)}`
		)
		.join(', ');
}

function formatTime(frame: number) {
	return `${(frame / SAMPLE_FPS).toFixed(2)}s`;
}
