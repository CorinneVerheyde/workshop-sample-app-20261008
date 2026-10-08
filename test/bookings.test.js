import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictError, createBooking, listBookings, ValidationError } from '../src/bookings.js';
import { createStore } from '../src/store.js';

const validBooking = {
  roomId: 'cedar',
  title: 'Product brainstorm',
  organizer: 'Alex Morgan',
  startTime: '2030-06-12T09:00:00Z',
  endTime: '2030-06-12T10:00:00Z',
};

test('each store starts with three stable rooms and no bookings', () => {
  const first = createStore();
  assert.deepEqual(first.rooms.map((room) => room.id), ['cedar', 'maple', 'aspen']);
  first.bookings.push({});
  first.rooms[0].name = 'Changed';
  const second = createStore();
  assert.equal(second.bookings.length, 0);
  assert.equal(second.rooms[0].name, 'Cedar');
});

test('creates a booking, trims text, and normalizes UTC timestamps', () => {
  const store = createStore();
  const result = createBooking(store, { ...validBooking, title: '  Product brainstorm  ', ignored: true });
  assert.match(result.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(result, {
    id: result.id, ...validBooking,
    startTime: '2030-06-12T09:00:00.000Z', endTime: '2030-06-12T10:00:00.000Z',
  });
  assert.equal(store.bookings.length, 1);
});

test('lists only the selected room and date in start-time order', () => {
  const store = createStore();
  const late = createBooking(store, { ...validBooking, startTime: '2030-06-12T14:00:00Z', endTime: '2030-06-12T15:00:00Z' });
  const early = createBooking(store, validBooking);
  createBooking(store, { ...validBooking, roomId: 'maple' });
  createBooking(store, { ...validBooking, startTime: '2030-06-13T09:00:00Z', endTime: '2030-06-13T10:00:00Z' });
  assert.deepEqual(listBookings(store, 'cedar', '2030-06-12').map((booking) => booking.id), [early.id, late.id]);
  assert.deepEqual(listBookings(store, 'cedar', '2030-06-14'), []);
});

test('a booking spanning midnight appears on each affected day, but not after its end', () => {
  const store = createStore();
  const booking = createBooking(store, {
    ...validBooking, startTime: '2030-06-12T23:00:00Z', endTime: '2030-06-14T00:00:00Z',
  });
  assert.deepEqual(listBookings(store, 'cedar', '2030-06-12'), [booking]);
  assert.deepEqual(listBookings(store, 'cedar', '2030-06-13'), [booking]);
  assert.deepEqual(listBookings(store, 'cedar', '2030-06-14'), []);
});

test('accepts a real leap day and millisecond timestamps', () => {
  const booking = createBooking(createStore(), {
    ...validBooking, startTime: '2032-02-29T09:00:00.125Z', endTime: '2032-02-29T10:00:00.125Z',
  });
  assert.equal(booking.startTime, '2032-02-29T09:00:00.125Z');
});

test('rejects a new booking fully inside an existing booking in the same room', () => {
  const store = createStore();
  createBooking(store, { ...validBooking, startTime: '2030-06-12T09:00:00Z', endTime: '2030-06-12T12:00:00Z' });
  assert.throws(() => createBooking(store, { ...validBooking, startTime: '2030-06-12T10:00:00Z', endTime: '2030-06-12T11:00:00Z' }), ConflictError);
  assert.equal(store.bookings.length, 1);
});

test('rejects a new booking that fully contains an existing booking in the same room', () => {
  const store = createStore();
  createBooking(store, { ...validBooking, startTime: '2030-06-12T10:00:00Z', endTime: '2030-06-12T11:00:00Z' });
  assert.throws(() => createBooking(store, { ...validBooking, startTime: '2030-06-12T09:00:00Z', endTime: '2030-06-12T12:00:00Z' }), ConflictError);
  assert.equal(store.bookings.length, 1);
});

test('rejects a new booking that partially overlaps the start of an existing booking', () => {
  const store = createStore();
  createBooking(store, { ...validBooking, startTime: '2030-06-12T10:00:00Z', endTime: '2030-06-12T11:00:00Z' });
  assert.throws(() => createBooking(store, { ...validBooking, startTime: '2030-06-12T09:30:00Z', endTime: '2030-06-12T10:30:00Z' }), ConflictError);
  assert.equal(store.bookings.length, 1);
});

test('rejects a new booking that partially overlaps the end of an existing booking', () => {
  const store = createStore();
  createBooking(store, { ...validBooking, startTime: '2030-06-12T10:00:00Z', endTime: '2030-06-12T11:00:00Z' });
  assert.throws(() => createBooking(store, { ...validBooking, startTime: '2030-06-12T10:30:00Z', endTime: '2030-06-12T11:30:00Z' }), ConflictError);
  assert.equal(store.bookings.length, 1);
});

test('accepts a back-to-back booking that starts exactly when an existing booking ends', () => {
  const store = createStore();
  createBooking(store, { ...validBooking, startTime: '2030-06-12T09:00:00Z', endTime: '2030-06-12T10:00:00Z' });
  const second = createBooking(store, { ...validBooking, startTime: '2030-06-12T10:00:00Z', endTime: '2030-06-12T11:00:00Z' });
  assert.equal(store.bookings.length, 2);
  assert.equal(second.startTime, '2030-06-12T10:00:00.000Z');
});

test('accepts a back-to-back booking that ends exactly when an existing booking starts', () => {
  const store = createStore();
  createBooking(store, { ...validBooking, startTime: '2030-06-12T10:00:00Z', endTime: '2030-06-12T11:00:00Z' });
  const second = createBooking(store, { ...validBooking, startTime: '2030-06-12T09:00:00Z', endTime: '2030-06-12T10:00:00Z' });
  assert.equal(store.bookings.length, 2);
  assert.equal(second.startTime, '2030-06-12T09:00:00.000Z');
});

test('allows identical and overlapping times in different rooms', () => {
  const store = createStore();
  createBooking(store, { ...validBooking, roomId: 'cedar' });
  const other = createBooking(store, { ...validBooking, roomId: 'maple' });
  assert.equal(store.bookings.length, 2);
  assert.equal(other.roomId, 'maple');
});

test('reports every conflicting booking sorted ascending by startTime, and leaves the store unchanged', () => {
  const store = createStore();
  const later = createBooking(store, { ...validBooking, startTime: '2030-06-12T13:00:00Z', endTime: '2030-06-12T14:00:00Z' });
  const earlier = createBooking(store, { ...validBooking, startTime: '2030-06-12T09:00:00Z', endTime: '2030-06-12T10:00:00Z' });
  try {
    createBooking(store, { ...validBooking, startTime: '2030-06-12T09:30:00Z', endTime: '2030-06-12T13:30:00Z' });
    assert.fail('expected a ConflictError');
  } catch (error) {
    assert.ok(error instanceof ConflictError);
    assert.deepEqual(error.conflicts.map((booking) => booking.id), [earlier.id, later.id]);
    assert.equal(error.status, 409);
  }
  assert.equal(store.bookings.length, 2);
});

const invalidInputs = [
  ['missing body', undefined],
  ['null body', null],
  ['array body', []],
  ['unknown room', { ...validBooking, roomId: 'missing' }],
  ['missing title', { ...validBooking, title: undefined }],
  ['blank title', { ...validBooking, title: '  ' }],
  ['long title', { ...validBooking, title: 'a'.repeat(101) }],
  ['blank organizer', { ...validBooking, organizer: ' ' }],
  ['non-string organizer', { ...validBooking, organizer: 123 }],
  ['missing timestamp', { ...validBooking, startTime: undefined }],
  ['invalid timestamp', { ...validBooking, startTime: 'not-a-date' }],
  ['missing UTC suffix', { ...validBooking, startTime: '2030-06-12T09:00:00' }],
  ['non-UTC offset', { ...validBooking, startTime: '2030-06-12T09:00:00+02:00' }],
  ['impossible day', { ...validBooking, startTime: '2030-02-30T09:00:00Z' }],
  ['invalid leap day', { ...validBooking, startTime: '2030-02-29T09:00:00Z' }],
  ['impossible hour', { ...validBooking, startTime: '2030-06-12T24:00:00Z' }],
  ['zero duration', { ...validBooking, endTime: validBooking.startTime }],
  ['negative duration', { ...validBooking, endTime: '2030-06-12T08:00:00Z' }],
];

for (const [description, input] of invalidInputs) {
  test(`rejects ${description} without storing a booking`, () => {
    const store = createStore();
    assert.throws(() => createBooking(store, input), ValidationError);
    assert.equal(store.bookings.length, 0);
  });
}

for (const date of [undefined, '', '2030-2-1', '2030-02-30', 'not-a-date']) {
  test(`rejects invalid date filter: ${String(date)}`, () => {
    assert.throws(() => listBookings(createStore(), 'cedar', date), ValidationError);
  });
}

test('rejects an unknown room filter', () => {
  assert.throws(() => listBookings(createStore(), 'missing', '2030-06-12'), ValidationError);
});
