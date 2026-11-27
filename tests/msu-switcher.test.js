const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'msu-switcher.js'), 'utf8');
const packFile = './addons/msuswitcher.txt';

function response(id) {
    return {
        getInt: (key) => key === '_http' ? 200 : undefined,
        has: (key) => key === 'data',
        getJSONArray: () => ({
            getJSONObject: () => ({ getString: (key) => key === 'id' ? id : undefined })
        })
    };
}

function realFunctions(overrides = {}, java = {}) {
    const marker = "    $.bind('command', function (event) {";
    assert.equal(source.split(marker).length, 2, 'expected exactly one command binding');
    const instrumented = source.replace(marker, `
    __exports.readHttpLine = readHttpLine;
    __exports.switchMsuPack = switchMsuPack;
    if (__overrides.buildWebSocketAccept) buildWebSocketAccept = __overrides.buildWebSocketAccept;
    if (__overrides.sendWebSocketText) sendWebSocketText = __overrides.sendWebSocketText;
    if (__overrides.sendWebSocketBinary) sendWebSocketBinary = __overrides.sendWebSocketBinary;
    if (__overrides.receiveWebSocketMessage) receiveWebSocketMessage = __overrides.receiveWebSocketMessage;
    if (__overrides.toJavaBytes) toJavaBytes = __overrides.toJavaBytes;
${marker}`);
    const exports = {};
    vm.runInNewContext(instrumented, {
        __exports: exports,
        __overrides: overrides,
        $: { bind: () => {}, consoleLn: () => {}, getSetIniDbString: (table, key, fallback) => fallback },
        Packages: { java: { ...java, util: { ...java.util, concurrent: { locks: { ReentrantLock: class {} } } } } }
    }, { filename: 'msu-switcher.js' });
    return exports;
}

function byteInput(bytes) {
    let position = 0;
    return { read: () => position < bytes.length ? bytes[position++] : -1 };
}

test('real HTTP line reader leaves WebSocket frame bytes after the headers', () => {
    const { readHttpLine } = realFunctions();
    const frame = [0x81, 0x02, 0x00, 0xff];
    const input = byteInput([...Buffer.from('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n'), ...frame]);

    assert.equal(readHttpLine(input), 'HTTP/1.1 101 Switching Protocols');
    assert.equal(readHttpLine(input), 'Upgrade: websocket');
    assert.equal(readHttpLine(input), '');
    assert.deepEqual(frame.map(() => input.read()), frame);
    assert.equal(input.read(), -1);
    assert.equal(readHttpLine(byteInput(Buffer.from('line\n'))), 'line');
});

test('real HTTP line reader enforces its limit and rejects incomplete lines', () => {
    const { readHttpLine } = realFunctions();
    const maximum = 'a'.repeat(8191);
    assert.equal(readHttpLine(byteInput(Buffer.from(maximum + '\n'))), maximum);
    assert.equal(readHttpLine(byteInput(Buffer.from(maximum.slice(1) + '\r\n'))), maximum.slice(1));
    assert.throws(() => readHttpLine(byteInput(Buffer.from('a'.repeat(8192) + '\n'))),
        /WebSocket handshake header too long/);
    assert.throws(() => readHttpLine(byteInput(Buffer.from(maximum + '\r\n'))),
        /WebSocket handshake header too long/);
    for (const partial of ['', 'partial', 'partial\r']) {
        assert.throws(() => readHttpLine(byteInput(Buffer.from(partial))),
            /Unexpected end of WebSocket handshake/);
    }
});

test('real switch rejects explicit invalid pack targets before sending a write', () => {
    function runSwitch(target) {
        const requests = [];
        const binaries = [];
        const frames = [
            { opcode: 1, data: Buffer.from('{"Results":["device"]}') },
            { opcode: 1, data: Buffer.from('{}') },
            { opcode: 2, data: [3, 1] }
        ];
        const input = byteInput(Buffer.from('HTTP/1.1 101 Switching Protocols\r\nSec-WebSocket-Accept: accepted\r\n\r\n'));
        const output = { write: () => {}, flush: () => {} };
        let closed = false;
        class Socket {
            connect() {}
            setSoTimeout() {}
            getInputStream() { return input; }
            getOutputStream() { return output; }
            isClosed() { return closed; }
            close() { closed = true; }
        }
        class JavaString {
            constructor(value) { this.value = Buffer.isBuffer(value) ? value.toString('utf8') : String(value); }
            getBytes() { return Buffer.from(this.value); }
            toString() { return this.value; }
        }
        const { switchMsuPack } = realFunctions({
            buildWebSocketAccept: () => 'accepted',
            sendWebSocketText: (stream, message) => requests.push(JSON.parse(message)),
            sendWebSocketBinary: (stream, payload) => binaries.push(payload),
            receiveWebSocketMessage: () => frames.shift() ?? null,
            toJavaBytes: (payload) => Array.from(payload)
        }, {
            net: { Socket, InetSocketAddress: class {} },
            lang: { String: JavaString },
            security: { SecureRandom: class { generateSeed() { return []; } } },
            util: { Base64: { getEncoder: () => ({ encodeToString: () => 'key' }) } }
        });
        const result = switchMsuPack(target, 'localhost:23074');
        assert.equal(closed, true);
        assert.equal(frames.length, 0, 'must reach the pack info response');
        return { result, requests, binaries };
    }

    for (const target of [-1, 3, 254, 255, 1.5, NaN, Infinity, '1']) {
        const { result, requests, binaries } = runSwitch(target);
        assert.equal(result.success, false, 'target ' + String(target));
        assert.equal(result.error, 'Invalid pack index: ' + String(target));
        assert.equal(requests.some((request) => request.Opcode === 'PutAddress'), false);
        assert.deepEqual(binaries, []);
    }
    for (const target of [0, 2]) {
        const { result, requests, binaries } = runSwitch(target);
        assert.equal(result.success, true);
        assert.equal(result.pack, target);
        assert.equal(result.currentPack, 1);
        assert.equal(result.totalPacks, 3);
        assert.deepEqual(requests.at(-1), { Opcode: 'PutAddress', Space: 'SNES', Operands: ['f5be7c', '1'] });
        assert.deepEqual(binaries, [[target]]);
    }
});

function harness(initialState, initialRewards = [], initialFiles = [], options = {}) {
    const handlers = {};
    const messages = [];
    const registrations = [];
    const files = new Map(initialFiles);
    const rewards = new Map(initialRewards.map((reward) => [reward.id, { ...reward }]));
    const calls = [];
    const statuses = [];
    const switches = [];
    const timers = new Map();
    let now = options.now ?? 100000;
    let nextTimer = 1;
    let storedState = initialState ? JSON.stringify(initialState) : undefined;
    let nextId = 1;
    let lockDepth = 0;
    const failures = (options.failures || []).slice();

    function failure(call) {
        const index = failures.findIndex((predicate) => predicate(call));
        if (index === -1) return false;
        failures.splice(index, 1);
        return true;
    }

    function titleConflict(id, title) {
        return options.uniqueTitles && title !== null && [...rewards.values()].some((reward) =>
            reward.id !== id && reward.title && reward.title.toLowerCase() === title.toLowerCase());
    }

    function failedResponse() {
        return { getInt: () => 400, has: () => false, toString: () => 'simulated failure' };
    }

    const phantombot = {
        PERMISSION: { Admin: 'admin' },
        bind: (name, handler) => { handlers[name] = handler; },
        registerChatCommand: (...args) => registrations.push(args),
        getSetIniDbString: (table, key, fallback) => {
            assert.equal(table, 'msuSwitcher');
            assert.equal(key, 'state');
            if (storedState === undefined) storedState = fallback;
            return storedState;
        },
        setIniDbString: (table, key, value) => {
            assert.equal(table, 'msuSwitcher');
            assert.equal(key, 'state');
            storedState = value;
        },
        readFile: (filename) => files.has(filename) ? files.get(filename).slice() : null,
        saveArray: (lines, filename, append) => {
            assert.equal(append, false);
            files.set(filename, Array.from(lines));
        },
        say: (message) => messages.push(message),
        consoleLn: () => {},
        testSwitch: (index, address) => {
            switches.push({ index, address });
            return options.switchResult ?? { success: true };
        },
        channelpoints: {
            updateRedemptionStatusCancelled: (rewardId, redemptionId) => {
                statuses.push({ status: 'cancelled', rewardId, redemptionId });
            },
            updateRedemptionStatusFulfilled: (rewardId, redemptionId) => {
                statuses.push({ status: 'fulfilled', rewardId, redemptionId });
            }
        },
        helix: {
            getCustomReward: () => ({
                getInt: (key) => key === '_http' ? 200 : undefined,
                has: (key) => key === 'data',
                getJSONArray: () => {
                    const managed = [...rewards.values()];
                    return {
                        length: () => managed.length,
                        getJSONObject: (index) => ({
                            getString: (key) => key === 'id' ? managed[index].id : undefined,
                            getBoolean: (key) => key === 'is_paused' ? Boolean(managed[index].paused) : undefined
                        })
                    };
                }
            }),
            createCustomReward: (title, cost, enabled, ...args) => {
                const id = 'reward-' + nextId++;
                const call = { operation: 'create', id, title, cost, enabled, args };
                calls.push(call);
                if (failure(call) || titleConflict(id, title)) return failedResponse();
                rewards.set(id, { id, title, cost, enabled, cooldown: args[8] });
                return response(id);
            },
            updateCustomReward: (id, title, cost, enabled, paused, ...args) => {
                const reward = rewards.get(id);
                assert.ok(reward, 'unknown reward ' + id);
                const call = { operation: 'update', id, title, cost, enabled, paused, args };
                calls.push(call);
                if (failure(call) || titleConflict(id, title)) return failedResponse();
                if (title !== null) reward.title = title;
                if (cost !== null) reward.cost = cost;
                if (enabled !== null) reward.enabled = enabled;
                if (paused !== null) reward.paused = paused;
                if (args[8] !== null) reward.cooldown = args[8];
                return response(id);
            }
        }
    };
    class ReentrantLock {
        lock() { lockDepth++; }
        unlock() { lockDepth--; }
    }
    const switchDeclaration = 'function switchMsuPack(target, connectionAddress) {';
    assert.equal(source.split(switchDeclaration).length, 2, 'expected exactly one switch implementation');
    const testSource = source.replace(switchDeclaration,
        'function switchMsuPack(target, connectionAddress) { return $.testSwitch(target, connectionAddress); }\n' +
        '    function originalSwitchMsuPack(target, connectionAddress) {');
    class FakeDate extends Date {
        static now() { return now; }
    }
    vm.runInNewContext(testSource, {
        $: phantombot,
        Date: FakeDate,
        setTimeout: (callback, delay) => {
            const id = nextTimer++;
            timers.set(id, { callback, due: now + delay });
            return id;
        },
        clearTimeout: (id) => timers.delete(id),
        Packages: { java: { util: { concurrent: { locks: { ReentrantLock } } } } }
    }, { filename: 'msu-switcher.js' });

    return {
        calls, files, handlers, messages, registrations, rewards, statuses, switches, timers,
        state: () => JSON.parse(storedState),
        elapse: (milliseconds) => { now += milliseconds; },
        redeem: (rewardId, redemptionId, status = 'UNFULFILLED') => {
            handlers.eventSubChannelPointsCustomRewardRedemptionAdd({
                event: () => ({
                    reward: () => ({ id: () => rewardId }),
                    id: () => redemptionId,
                    statusString: () => status
                })
            });
            assert.equal(lockDepth, 0, 'redemption must release its lock');
        },
        advance: (milliseconds) => {
            const end = now + milliseconds;
            while (true) {
                const next = [...timers.entries()].sort((first, second) => first[1].due - second[1].due)[0];
                if (!next || next[1].due > end) break;
                now = Math.max(now, next[1].due);
                timers.delete(next[0]);
                next[1].callback();
                assert.equal(lockDepth, 0, 'timer must release its lock');
            }
            now = end;
        },
        command: (...args) => {
            handlers.command({ getCommand: () => 'msuswitch', getArgs: () => args });
            assert.equal(lockDepth, 0, 'command must release its lock');
            return messages.at(-1);
        }
    };
}

test('admin setup saves multiword pack names, enables two rewards, and reuses them', () => {
    const bot = harness();
    bot.handlers.initReady();
    assert.deepEqual(bot.registrations, [['./custom/msu-switcher.js', 'msuswitch', 'admin']]);

    assert.equal(bot.command('cost', '500'), 'MSU base cost set to 500.');
    assert.equal(bot.command('cooldown', '60'), 'MSU cooldown set to 60 seconds.');
    assert.equal(bot.command('increase', '25'), 'MSU per-redemption increase set to 25.');
    assert.equal(bot.command('setup', 'LoZ', 'Remade,', 'Super', 'Mario', 'Galaxy'),
        'MSU rewards configured for 2 packs.');

    assert.deepEqual(bot.files.get(packFile), ['LoZ Remade', 'Super Mario Galaxy']);
    const firstState = bot.state();
    assert.equal(firstState.baseCost, 500);
    assert.equal(firstState.cooldown, 60);
    assert.equal(firstState.increase, 25);
    assert.equal(firstState.active, true);
    assert.deepEqual(firstState.slots.map((slot) => slot.name), ['LoZ Remade', 'Super Mario Galaxy']);
    const ids = firstState.slots.map((slot) => slot.id);
    assert.equal(new Set(ids).size, 2);
    assert.deepEqual([...bot.rewards.values()].filter((reward) => reward.enabled).map((reward) => reward.id), ids);
    assert.deepEqual([...bot.rewards.values()].map(({ title, cost, cooldown }) => ({ title, cost, cooldown })), [
        { title: 'MSU: LoZ Remade', cost: 500, cooldown: 60 },
        { title: 'MSU: Super Mario Galaxy', cost: 500, cooldown: 60 }
    ]);
    assert.equal(bot.command('list'), 'MSU cost: 500, increase: 25, cooldown: 60s. ' +
        '0: LoZ Remade (500, enabled); 1: Super Mario Galaxy (500, enabled)');

    const reloaded = harness(bot.state(), [...bot.rewards.values()], [...bot.files]);
    assert.equal(reloaded.command('setup'), 'MSU rewards configured for 2 packs.');
    assert.deepEqual(reloaded.state().slots.map((slot) => slot.id), ids);
    assert.equal(reloaded.calls.filter((call) => call.operation === 'create').length, 0);
    assert.deepEqual([...reloaded.rewards.values()].filter((reward) => reward.enabled).map((reward) => reward.id), ids);
    assert.equal(reloaded.command('teardown'), 'MSU rewards disabled.');
    assert.equal(reloaded.state().active, false);
    assert.ok(reloaded.state().slots.every((slot) => !slot.active));
    assert.equal([...reloaded.rewards.values()].filter((reward) => reward.enabled).length, 0);
});

test('setup swaps titles and reuses disabled slots after shrinking the pack list', () => {
    const bot = harness(null, [], [], { uniqueTitles: true });
    bot.command('cost', '500');
    bot.command('cooldown', '60');
    assert.equal(bot.command('setup', 'First,', 'Second,', 'Third'), 'MSU rewards configured for 3 packs.');
    const ids = bot.state().slots.map((slot) => slot.id);

    assert.equal(bot.command('setup', 'Second,', 'First'), 'MSU rewards configured for 2 packs.');
    assert.deepEqual(bot.state().slots.map((slot) => slot.id), ids);
    assert.ok(ids.every((id) => bot.calls.some((call) => call.id === id && call.title === 'MSU-' + id)));
    assert.deepEqual(ids.map((id) => [bot.rewards.get(id).title, bot.rewards.get(id).enabled]), [
        ['MSU: Second', true], ['MSU: First', true], ['MSU-' + ids[2], false]
    ]);
    assert.deepEqual(bot.state().slots.map((slot) => slot.active), [true, true, false]);

    assert.equal(bot.command('setup', 'Third,', 'Second,', 'First'), 'MSU rewards configured for 3 packs.');
    assert.deepEqual(bot.state().slots.map((slot) => slot.id), ids);
    assert.deepEqual(ids.map((id) => [bot.rewards.get(id).title, bot.rewards.get(id).enabled]), [
        ['MSU: Third', true], ['MSU: Second', true], ['MSU: First', true]
    ]);
    assert.equal(bot.calls.filter((call) => call.operation === 'create').length, 3);
});

test('resetcosts clears accumulated increases and updates active and disabled rewards', () => {
    const bot = harness({
        baseCost: 500, cooldown: 60, increase: 25, active: true,
        slots: [
            { id: 'one', name: 'First Pack', increase: 75, active: true, appliedCost: 575 },
            { id: 'two', name: 'Second Pack', increase: 50, active: false, appliedCost: 550 }
        ],
        seen: [], cooldownUntil: 0, cooldownSource: '', paused: []
    }, [
        { id: 'one', cost: 575, enabled: true },
        { id: 'two', cost: 550, enabled: false }
    ]);

    assert.equal(bot.command('resetcosts'), 'MSU reward costs reset.');
    assert.deepEqual(bot.state().slots.map((slot) => [slot.increase, slot.appliedCost]), [[0, 500], [0, 500]]);
    assert.equal(bot.state().increase, 25);
    assert.deepEqual([...bot.rewards.values()].map((reward) => [reward.id, reward.cost, reward.enabled]),
        [['one', 500, true], ['two', 500, false]]);
});

test('missing settings, arguments, or invalid pack lists are rejected', () => {
    const bot = harness();
    assert.match(bot.command('setup', 'First'), /Set cost and cooldown before setup/);
    for (const setting of ['cost', 'cooldown', 'increase']) {
        assert.match(bot.command(setting), /Expected .* integer/);
    }
    bot.command('cost', '100');
    bot.command('cooldown', '30');
    const before = bot.state();
    for (const args of [
        ['setup'],
        ['setup', 'First,'],
        ['setup', 'First,', 'first'],
        ['setup', 'One,', 'Two,', 'Three,', 'Four,', 'Five,', 'Six']
    ]) {
        assert.match(bot.command(...args), /^MSU switcher error:/);
        assert.deepEqual(bot.state(), before);
        assert.equal(bot.rewards.size, 0);
        assert.equal(bot.files.has(packFile), false);
    }
});

function configuredBot(options = {}) {
    return harness({
        baseCost: 500, cooldown: 60, increase: 25, active: true,
        slots: [
            { id: 'one', name: 'First Pack', increase: 0, active: true, appliedCost: 500 },
            { id: 'two', name: 'Second Pack', increase: 0, active: true, appliedCost: 500 }
        ],
        seen: [], cooldownUntil: 0, cooldownSource: '', paused: []
    }, [
        { id: 'one', cost: 500, enabled: true, paused: false },
        { id: 'two', cost: 500, enabled: true, paused: Boolean(options.secondPaused) }
    ], [], options);
}

test('successful redemption shares cooldown, increases only its cost, and deduplicates events', () => {
    const bot = configuredBot();
    bot.redeem('one', 'redemption-1');

    assert.deepEqual(bot.switches, [{ index: 0, address: '192.168.1.19:23074' }]);
    assert.deepEqual(bot.statuses, [{ status: 'fulfilled', rewardId: 'one', redemptionId: 'redemption-1' }]);
    assert.equal(bot.rewards.get('one').cost, 525);
    assert.equal(bot.rewards.get('two').cost, 500);
    assert.equal(bot.rewards.get('one').paused, false);
    assert.equal(bot.rewards.get('two').paused, true);
    assert.deepEqual(bot.state().paused, ['two']);
    assert.equal(bot.state().cooldownUntil, 160000);
    assert.equal(bot.timers.size, 1);

    bot.redeem('two', 'redemption-2');
    assert.deepEqual(bot.statuses.at(-1), { status: 'cancelled', rewardId: 'two', redemptionId: 'redemption-2' });
    const callsBeforeDuplicate = bot.calls.length;
    bot.redeem('one', 'redemption-1');
    bot.redeem('two', 'redemption-2');
    assert.equal(bot.calls.length, callsBeforeDuplicate);
    assert.equal(bot.switches.length, 1);
    assert.equal(bot.statuses.length, 2);

    bot.advance(59999);
    assert.equal(bot.rewards.get('two').paused, true);
    bot.advance(1);
    assert.equal(bot.rewards.get('two').paused, false);
    assert.deepEqual(bot.state().paused, []);
    assert.equal(bot.state().cooldownUntil, 0);
    assert.equal(bot.timers.size, 0);
});

test('failed switch cancels without increasing cost but retains cooldown until timer expires', () => {
    const bot = configuredBot({ switchResult: { success: false, error: 'unavailable' } });
    bot.redeem('one', 'failed');

    assert.deepEqual(bot.statuses, [{ status: 'cancelled', rewardId: 'one', redemptionId: 'failed' }]);
    assert.equal(bot.rewards.get('one').cost, 500);
    assert.equal(bot.state().slots[0].increase, 0);
    assert.equal(bot.rewards.get('two').paused, true);
    assert.equal(bot.state().cooldownUntil, 160000);
    bot.advance(60000);
    assert.equal(bot.rewards.get('two').paused, false);
    assert.equal(bot.state().cooldownUntil, 0);
});

test('pre-paused rewards remain paused after cooldown', () => {
    const bot = configuredBot({ secondPaused: true });
    bot.redeem('one', 'redemption-1');
    assert.deepEqual(bot.state().paused, []);
    assert.equal(bot.calls.some((call) => call.id === 'two' && call.paused !== null), false);
    bot.advance(60000);
    assert.equal(bot.rewards.get('two').paused, true);
    assert.equal(bot.state().cooldownUntil, 0);
});

test('restart resumes a persisted cooldown at its original expiry', () => {
    const bot = configuredBot();
    bot.redeem('one', 'redemption-1');
    const restarted = harness(bot.state(), [...bot.rewards.values()], [], { now: 130000 });
    restarted.handlers.initReady();
    assert.equal(restarted.timers.size, 1);
    restarted.advance(30000);
    assert.equal(restarted.rewards.get('two').paused, false);
    assert.deepEqual(restarted.state().paused, []);
    assert.equal(restarted.state().cooldownUntil, 0);
});

test('non-unfulfilled and unrelated redemption events are ignored', () => {
    const bot = configuredBot();
    bot.redeem('one', 'fulfilled', 'FULFILLED');
    bot.redeem('unknown', 'unrelated');
    assert.deepEqual(bot.statuses, []);
    assert.deepEqual(bot.switches, []);
    assert.deepEqual(bot.state().seen, []);
    assert.equal(bot.timers.size, 0);
});

test('a transient pause failure is retried during the shared cooldown', () => {
    const bot = configuredBot({
        switchResult: { success: false, error: 'unavailable' },
        failures: [(call) => call.id === 'two' && call.paused === true]
    });
    bot.redeem('one', 'pause-failure');
    assert.equal(bot.rewards.get('two').paused, false);
    assert.deepEqual(bot.state().paused, ['two']);
    assert.equal(bot.timers.size, 1);

    bot.advance(29999);
    assert.equal(bot.rewards.get('two').paused, false);
    bot.advance(1);
    assert.equal(bot.rewards.get('two').paused, true);
    assert.equal(bot.calls.filter((call) => call.id === 'two' && call.paused === true).length, 2);
    bot.advance(30000);
    assert.equal(bot.rewards.get('two').paused, false);
    assert.deepEqual(bot.state().paused, []);
});

test('a transient redemption cost update failure is retried without increasing twice', () => {
    const bot = configuredBot({ failures: [(call) => call.id === 'one' && call.cost === 525] });
    bot.redeem('one', 'cost-failure');
    assert.equal(bot.rewards.get('one').cost, 500);
    assert.equal(bot.state().slots[0].increase, 25);
    assert.equal(bot.state().slots[0].pendingCost, true);
    assert.deepEqual(bot.statuses, [{ status: 'fulfilled', rewardId: 'one', redemptionId: 'cost-failure' }]);

    bot.advance(30000);
    assert.equal(bot.rewards.get('one').cost, 525);
    assert.equal(bot.state().slots[0].appliedCost, 525);
    assert.equal(bot.state().slots[0].pendingCost, false);
    assert.equal(bot.calls.filter((call) => call.id === 'one' && call.cost === 525).length, 2);
    assert.equal(bot.switches.length, 1);
});

for (const setting of [
    { command: 'cost', value: '600', matches: (call) => call.cost === 600, field: 'pendingCost', rewardField: 'cost', expected: 600 },
    { command: 'cooldown', value: '90', matches: (call) => call.args[8] === 90, field: 'pendingCooldown', rewardField: 'cooldown', expected: 90 }
]) {
    test('a transient ' + setting.command + ' command update failure is retried', () => {
        const bot = configuredBot({ failures: [(call) => call.id === 'one' && setting.matches(call)] });
        assert.match(bot.command(setting.command, setting.value), /^MSU switcher error:/);
        assert.equal(bot.rewards.get('one')[setting.rewardField], setting.expected);
        assert.equal(bot.state().slots[0][setting.field], false);
        assert.equal(bot.calls.filter((call) => call.id === 'one' && setting.matches(call)).length, 2);
        assert.equal(bot.timers.size, 0);
    });

    test('repeated ' + setting.command + ' update failure schedules a retry', () => {
        const matches = (call) => call.id === 'one' && setting.matches(call);
        const bot = configuredBot({ failures: [matches, matches] });
        assert.match(bot.command(setting.command, setting.value), /^MSU switcher error:/);
        assert.equal(bot.state().slots[0][setting.field], true);
        assert.notEqual(bot.rewards.get('one')[setting.rewardField], setting.expected);
        assert.equal(bot.timers.size, 1);
        bot.advance(30000);
        assert.equal(bot.rewards.get('one')[setting.rewardField], setting.expected);
        assert.equal(bot.state().slots[0][setting.field], false);
        assert.equal(bot.calls.filter(matches).length, 3);
    });
}

test('a partial setup failure disables rewards already enabled and permits a retry', () => {
    const bot = configuredBot({
        uniqueTitles: true,
        failures: [(call) => call.id === 'two' && call.enabled === true]
    });
    assert.match(bot.command('setup', 'First,', 'Second'), /^MSU switcher error:/);
    assert.equal(bot.state().active, false);
    assert.deepEqual(bot.state().slots.map((slot) => slot.active), [false, false]);
    assert.deepEqual([...bot.rewards.values()].map((reward) => reward.enabled), [false, false]);
    assert.equal(bot.calls.filter((call) => call.id === 'one' && call.enabled === true).length, 1);

    assert.equal(bot.command('setup'), 'MSU rewards configured for 2 packs.');
    assert.equal(bot.state().active, true);
    assert.deepEqual(bot.state().slots.map((slot) => slot.id), ['one', 'two']);
    assert.deepEqual([...bot.rewards.values()].map((reward) => reward.enabled), [true, true]);
    assert.equal(bot.calls.filter((call) => call.operation === 'create').length, 0);
});

test('a failed setup cleanup disable is retried while the switcher remains inactive', () => {
    let setupFailed = false;
    const bot = configuredBot({ failures: [
        (call) => {
            if (call.id !== 'two' || call.enabled !== true) return false;
            setupFailed = true;
            return true;
        },
        (call) => setupFailed && call.id === 'one' && call.enabled === false
    ] });
    assert.match(bot.command('setup', 'First,', 'Second'), /^MSU switcher error:/);
    assert.equal(bot.state().active, false);
    assert.equal(bot.rewards.get('one').enabled, false);
    assert.equal(bot.rewards.get('two').enabled, false);
    assert.equal(bot.state().slots[0].pendingDisable, false);
    bot.redeem('one', 'inactive');
    assert.deepEqual(bot.statuses, [{ status: 'cancelled', rewardId: 'one', redemptionId: 'inactive' }]);
    assert.deepEqual(bot.switches, []);

    assert.equal(bot.command('teardown'), 'MSU rewards disabled.');
    assert.deepEqual([...bot.rewards.values()].map((reward) => reward.enabled), [false, false]);
    assert.deepEqual(bot.state().slots.map((slot) => slot.active), [false, false]);
});

test('an expired cooldown with a failed unpause cancels redemption until cleanup succeeds', () => {
    const bot = configuredBot({ failures: [(call) => call.id === 'two' && call.paused === false] });
    bot.redeem('one', 'first');
    bot.elapse(60000);
    bot.redeem('one', 'after-expiry');
    assert.deepEqual(bot.statuses.at(-1), { status: 'cancelled', rewardId: 'one', redemptionId: 'after-expiry' });
    assert.equal(bot.switches.length, 1);
    assert.deepEqual(bot.state().paused, ['two']);
    assert.equal(bot.state().cooldownUntil, 160000);
    assert.equal(bot.rewards.get('two').paused, true);

    bot.advance(0);
    assert.deepEqual(bot.state().paused, []);
    assert.equal(bot.state().cooldownUntil, 0);
    assert.equal(bot.rewards.get('two').paused, false);
    bot.redeem('one', 'after-cleanup');
    assert.equal(bot.statuses.at(-1).status, 'fulfilled');
    assert.equal(bot.switches.length, 2);
});
