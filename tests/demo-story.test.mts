import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const FRAME_WIDTH = 1280;
const FRAME_HEIGHT = 720;
const NOTE_CHROME = { x: 250, y: 0, width: 220, height: 36 };
const EDITOR_BODY = { x: 250, y: 60, width: 1000, height: 530 };
const SAME_NOTE_TOLERANCE = 0.003;
const DIFFERENT_NOTE_THRESHOLD = 0.01;
const DISTINCT_STOP_THRESHOLD = 0.015;
const RESTORED_STOP_TOLERANCE = 0.006;
const UNRELATED_HIGHLIGHT_LIMIT = 250;

const SAMPLE_TIMES = {
	a: 0.75,
	b: 2.25,
	c: 3.75,
	d: 5.25,
	backToC: 7.25,
	backToB: 9.25,
	backToA: 11.25,
};

describe('Cursor History demo story', () => {
	it('shows three same-note stops, crosses files, then restores C, B, and A', () => {
		// Arrange
		const { frame } = createTestContext();
		const a = frame('a');
		const b = frame('b');
		const c = frame('c');
		const d = frame('d');
		const backToC = frame('backToC');
		const backToB = frame('backToB');
		const backToA = frame('backToA');

		// Act
		const noteDistances = {
			aToB: regionDistance(a, b, NOTE_CHROME),
			bToC: regionDistance(b, c, NOTE_CHROME),
			cToD: regionDistance(c, d, NOTE_CHROME),
		};
		const stopDistances = {
			aToB: regionDistance(a, b, EDITOR_BODY),
			bToC: regionDistance(b, c, EDITOR_BODY),
		};
		const restorationDistances = {
			c: regionDistance(c, backToC, EDITOR_BODY),
			b: regionDistance(b, backToB, EDITOR_BODY),
			a: regionDistance(a, backToA, EDITOR_BODY),
		};
		const unrelatedHighlights = countYellowHighlightPixels(d, EDITOR_BODY);

		// Assert
		assert.ok(
			noteDistances.aToB <= SAME_NOTE_TOLERANCE,
			`stops A and B must use the same note; visual distance was ${formatDistance(noteDistances.aToB)}`
		);
		assert.ok(
			noteDistances.bToC <= SAME_NOTE_TOLERANCE,
			`stops B and C must use the same note; visual distance was ${formatDistance(noteDistances.bToC)}`
		);
		assert.ok(
			noteDistances.cToD >= DIFFERENT_NOTE_THRESHOLD,
			`stop D must use a different note from C; visual distance was ${formatDistance(noteDistances.cToD)}`
		);
		assert.ok(
			stopDistances.aToB >= DISTINCT_STOP_THRESHOLD,
			`stops A and B must show different viewport or selection positions; visual distance was ${formatDistance(stopDistances.aToB)}`
		);
		assert.ok(
			stopDistances.bToC >= DISTINCT_STOP_THRESHOLD,
			`stops B and C must show different viewport or selection positions; visual distance was ${formatDistance(stopDistances.bToC)}`
		);
		assert.ok(
			restorationDistances.c <= RESTORED_STOP_TOLERANCE,
			`the first Back action must restore stop C; visual distance was ${formatDistance(restorationDistances.c)}`
		);
		assert.ok(
			restorationDistances.b <= RESTORED_STOP_TOLERANCE,
			`the second Back action must restore stop B; visual distance was ${formatDistance(restorationDistances.b)}`
		);
		assert.ok(
			restorationDistances.a <= RESTORED_STOP_TOLERANCE,
			`the third Back action must restore stop A; visual distance was ${formatDistance(restorationDistances.a)}`
		);
		assert.ok(
			unrelatedHighlights <= UNRELATED_HIGHLIGHT_LIMIT,
			`stop D must show only its active selection; found ${unrelatedHighlights} yellow search-highlight pixels`
		);
	});

	function createTestContext({
		videoUrl = new URL('../docs/assets/cursor-history-demo.mp4', import.meta.url),
	} = {}) {
		const decodedFrames = new Map<keyof typeof SAMPLE_TIMES, Buffer>();

		return {
			frame(stop: keyof typeof SAMPLE_TIMES) {
				const cached = decodedFrames.get(stop);
				if (cached) {
					return cached;
				}

				const decoded = decodeFrame(fileURLToPath(videoUrl), SAMPLE_TIMES[stop]);
				decodedFrames.set(stop, decoded);
				return decoded;
			},
		};
	}
});

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
			'-f',
			'rawvideo',
			'-pix_fmt',
			'rgb24',
			'pipe:1',
		],
		{ maxBuffer: FRAME_WIDTH * FRAME_HEIGHT * 4 }
	);

	assert.equal(
		result.status,
		0,
		`ffmpeg could not decode the demo frame: ${result.stderr.toString().trim()}`
	);
	assert.equal(
		result.stdout.length,
		FRAME_WIDTH * FRAME_HEIGHT * 3,
		`expected a ${FRAME_WIDTH}x${FRAME_HEIGHT} RGB frame`
	);
	return result.stdout;
}

function regionDistance(
	left: Buffer,
	right: Buffer,
	region: { x: number; y: number; width: number; height: number }
) {
	let totalDifference = 0;

	for (let y = region.y; y < region.y + region.height; ++y) {
		const rowStart = (y * FRAME_WIDTH + region.x) * 3;
		const rowEnd = rowStart + region.width * 3;
		for (let offset = rowStart; offset < rowEnd; ++offset) {
			totalDifference += Math.abs(left[offset] - right[offset]);
		}
	}

	return totalDifference / (region.width * region.height * 3 * 255);
}

function countYellowHighlightPixels(
	frame: Buffer,
	region: { x: number; y: number; width: number; height: number }
) {
	let count = 0;

	for (let y = region.y; y < region.y + region.height; ++y) {
		for (let x = region.x; x < region.x + region.width; ++x) {
			const offset = (y * FRAME_WIDTH + x) * 3;
			const red = frame[offset];
			const green = frame[offset + 1];
			const blue = frame[offset + 2];
			if (
				red >= 70 &&
				green >= 55 &&
				blue <= 65 &&
				red - blue >= 35 &&
				green - blue >= 20
			) {
				count++;
			}
		}
	}

	return count;
}

function formatDistance(distance: number) {
	return distance.toFixed(4);
}
