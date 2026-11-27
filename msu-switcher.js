/*
 * Copyright (C) 2019 cheuer
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

(function () {

    /*
    packs:
    0 LoZ Remade
    1 NES Mix
    2 Origami King
    3 Sea of Stars
    4 Super Mario Galaxy

    0xF650AA - numb of detected packs
    B - current pack in use
    C is what you write to to queue a pack change
    Having F650AC be 255 switches to SPC music, 254 mutes?
    The change only happens during a music transition, and only if it's a non race rom
    */

    const DEFAULT_MSU_ADDRESS = '192.168.1.19:23074';
    const MSU_PACK_INFO = 'f5be7a';
    const MSU_PACK_REQUEST = 'f5be7c';
    const PACK_FILE = './addons/msuswitcher.txt';
    const STATE_TABLE = 'msuSwitcher';
    const MAX_SLOTS = 5;
    const MAX_COST = 2147483647;
    let lock = new Packages.java.util.concurrent.locks.ReentrantLock();
    let state = JSON.parse($.getSetIniDbString(STATE_TABLE, 'state', '{"baseCost":0,"cooldown":0,"increase":0,"active":false,"slots":[],"seen":[],"cooldownUntil":0,"cooldownSource":"","paused":[]}'));

    function saveState() {
        $.setIniDbString(STATE_TABLE, 'state', JSON.stringify(state));
    }

    function checkResponse(response, operation) {
        if (response.getInt('_http') !== 200 || !response.has('data')) {
            throw new Error(operation + ' failed: ' + response.toString());
        }
        return response;
    }

    function updateReward(id, title, cost, enabled, paused, cooldown) {
        return checkResponse($.helix.updateCustomReward(id, title, cost, enabled, paused, null, null, null,
            false, null, false, null,
            cooldown === null ? null : true, cooldown, null), 'Update reward ' + id);
    }

    function createReward(title, cost, cooldown) {
        var response = checkResponse($.helix.createCustomReward(title, cost, false, null, false, null,
            false, null, false, null, true, cooldown, false), 'Create reward ' + title);
        return String(response.getJSONArray('data').getJSONObject(0).getString('id'));
    }

    function rewardTitle(name) {
        return 'MSU: ' + name;
    }

    function packNames(lines) {
        if (!lines || lines.length < 1 || lines.length > MAX_SLOTS) {
            throw new Error('Provide between 1 and ' + MAX_SLOTS + ' pack names.');
        }
        var names = [];
        for (var index = 0; index < lines.length; index++) {
            var name = String(lines[index]).trim();
            if (!name || rewardTitle(name).length > 45 || /[\r\n]/.test(name)) {
                throw new Error('Pack names must be nonempty and fit in a 45-character reward title.');
            }
            if (names.some(function (previous) { return previous.toLowerCase() === name.toLowerCase(); })) {
                throw new Error('Pack names must be distinct.');
            }
            names.push(name);
        }
        return names;
    }

    function slotCost(slot) {
        var cost = state.baseCost + (slot.increase || 0);
        if (!Number.isSafeInteger(cost) || cost < 1 || cost > MAX_COST) {
            throw new Error('Reward cost is outside the supported range.');
        }
        return cost;
    }

    function setupRewards(names) {
        if (!state.baseCost || !state.cooldown) {
            throw new Error('Set cost and cooldown before setup.');
        }
        names.forEach(function (name, index) { slotCost(state.slots[index] || {}); });
        state.active = false;
        saveState();
        try {
            state.slots.forEach(function (slot) {
                if (slot.id) {
                    updateReward(slot.id, null, null, false, null, null);
                    slot.active = false;
                    slot.pendingDisable = false;
                    saveState();
                }
            });
            state.slots.forEach(function (slot) {
                if (slot.id) {
                    updateReward(slot.id, 'MSU-' + slot.id, null, null, null, null);
                }
            });
            names.forEach(function (name, index) {
                var slot = state.slots[index];
                if (!slot) {
                    slot = { id: '', name: '', increase: 0, active: false };
                    state.slots[index] = slot;
                }
                if (!slot.id) {
                    slot.id = createReward(rewardTitle(name), slotCost(slot), state.cooldown);
                    saveState();
                }
                updateReward(slot.id, rewardTitle(name), slotCost(slot), false, null, state.cooldown);
                slot.appliedCost = slotCost(slot);
                slot.pendingCost = false;
                slot.pendingCooldown = false;
                saveState();
            });
            names.forEach(function (name, index) { state.slots[index].name = name; });
            saveState();
            names.forEach(function (name, index) {
                var slot = state.slots[index];
                if (state.cooldownUntil > Date.now() && slot.id !== state.cooldownSource) {
                    ensurePaused(slot.id);
                }
                updateReward(slot.id, null, null, true, null, null);
                slot.active = true;
                saveState();
            });
            state.active = true;
            saveState();
        } catch (error) {
            state.active = false;
            state.slots.forEach(function (slot) {
                if (slot.id) {
                    try {
                        updateReward(slot.id, null, null, false, null, null);
                        slot.active = false;
                        slot.pendingDisable = false;
                    } catch (disableError) {
                        slot.pendingDisable = true;
                        $.consoleLn('MSU failed to disable reward ' + slot.id + ': ' + disableError);
                    }
                }
            });
            saveState();
            throw error;
        }
    }

    function updateCosts(includeDisabled) {
        var failures = [];
        state.slots.forEach(function (slot) {
            if (slot.id && (includeDisabled || slot.active)) {
                slot.pendingCost = true;
                saveState();
                try {
                    updateReward(slot.id, null, slotCost(slot), null, null, null);
                    slot.appliedCost = slotCost(slot);
                    slot.pendingCost = false;
                    saveState();
                } catch (error) {
                    failures.push(slot.name + ': ' + error);
                }
            }
        });
        if (failures.length) {
            throw new Error(failures.join('; '));
        }
    }

    function integerSetting(value, allowZero) {
        var text = String(value);
        var number = Number(text);
        if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number > MAX_COST || number < (allowZero ? 0 : 1)) {
            throw new Error('Expected ' + (allowZero ? 'a non-negative' : 'a positive') + ' integer.');
        }
        return number;
    }

    let maintenanceTimer = null;

    function isRewardPaused(id) {
        var response = checkResponse($.helix.getCustomReward(null, true), 'Read managed rewards');
        var rewards = response.getJSONArray('data');
        for (var index = 0; index < rewards.length(); index++) {
            var reward = rewards.getJSONObject(index);
            if (String(reward.getString('id')) === id) {
                return reward.getBoolean('is_paused');
            }
        }
        throw new Error('Managed reward not found: ' + id);
    }

    function ensurePaused(id) {
        if (state.paused.indexOf(id) === -1) {
            if (isRewardPaused(id)) {
                return;
            }
            state.paused.push(id);
            saveState();
        }
        updateReward(id, null, null, null, true, null);
    }

    function reconcileCooldown() {
        var failed = false;
        if (state.cooldownUntil > Date.now()) {
            state.slots.forEach(function (slot) {
                if (state.active && slot.active && slot.id !== state.cooldownSource) {
                    try {
                        ensurePaused(slot.id);
                    } catch (error) {
                        failed = true;
                        $.consoleLn('MSU cooldown pause failed: ' + error);
                    }
                }
            });
        } else if (state.cooldownUntil || state.paused.length) {
            state.paused.slice().forEach(function (id) {
                try {
                    updateReward(id, null, null, null, false, null);
                    state.paused.splice(state.paused.indexOf(id), 1);
                    saveState();
                } catch (error) {
                    failed = true;
                    $.consoleLn('MSU cooldown resume failed: ' + error);
                }
            });
            if (!state.paused.length) {
                state.cooldownUntil = 0;
                state.cooldownSource = '';
                saveState();
            }
        }
        return failed;
    }

    function maintainRewards() {
        lock.lock();
        try {
            var failed = reconcileCooldown();
            state.slots.forEach(function (slot) {
                if (slot.id && slot.pendingDisable) {
                    try {
                        updateReward(slot.id, null, null, false, null, null);
                        slot.active = false;
                        slot.pendingDisable = false;
                        saveState();
                    } catch (error) {
                        failed = true;
                        $.consoleLn('MSU disable retry failed: ' + error);
                    }
                }
                if (slot.id && slot.pendingCost) {
                    try {
                        updateReward(slot.id, null, slotCost(slot), null, null, null);
                        slot.appliedCost = slotCost(slot);
                        slot.pendingCost = false;
                        saveState();
                    } catch (error) {
                        failed = true;
                        $.consoleLn('MSU cost update failed: ' + error);
                    }
                }
                if (slot.id && slot.pendingCooldown) {
                    try {
                        updateReward(slot.id, null, null, null, null, state.cooldown);
                        slot.pendingCooldown = false;
                        saveState();
                    } catch (error) {
                        failed = true;
                        $.consoleLn('MSU cooldown update failed: ' + error);
                    }
                }
            });
            if (maintenanceTimer !== null) {
                clearTimeout(maintenanceTimer);
                maintenanceTimer = null;
            }
            if (failed || state.cooldownUntil > Date.now()) {
                var delay = failed ? 30000 : 2147483647;
                if (state.cooldownUntil > Date.now()) {
                    delay = Math.min(delay, Math.max(1, state.cooldownUntil - Date.now()));
                }
                maintenanceTimer = setTimeout(maintainRewards, Math.min(delay, 2147483647));
            }
        } finally {
            lock.unlock();
        }
    }

    $.bind('eventSubChannelPointsCustomRewardRedemptionAdd', function (event) {
        var redemption = event.event();
        var rewardId = String(redemption.reward().id());
        var redemptionId = String(redemption.id());
        var queued = false;
        lock.lock();
        try {
            var index = state.slots.findIndex(function (slot) { return slot.id === rewardId; });
            if (index === -1 || state.seen.indexOf(redemptionId) !== -1) {
                return;
            }
            if (String(redemption.statusString()).toLowerCase() !== 'unfulfilled') {
                $.consoleLn('MSU redemption is not unfulfilled: ' + redemptionId);
                return;
            }
            state.seen.push(redemptionId);
            if (state.seen.length > 500) {
                state.seen.shift();
            }
            saveState();
            var slot = state.slots[index];
            if (state.cooldownUntil && state.cooldownUntil <= Date.now()) {
                reconcileCooldown();
            }
            if (!state.active || !slot.active || state.cooldownUntil > Date.now() || state.paused.length) {
                $.channelpoints.updateRedemptionStatusCancelled(rewardId, redemptionId);
                return;
            }
            state.cooldownUntil = Date.now() + state.cooldown * 1000;
            state.cooldownSource = rewardId;
            saveState();
            maintainRewards();
            var result = switchMsuPack(index, DEFAULT_MSU_ADDRESS);
            if (!result.success) {
                $.consoleLn('MSU pack switch failed: ' + result.error);
                $.channelpoints.updateRedemptionStatusCancelled(rewardId, redemptionId);
                $.say('Unable to queue the requested MSU pack.');
                return;
            }
            queued = true;
            if (state.increase > 0) {
                if (slotCost(slot) + state.increase <= MAX_COST) {
                    slot.increase = (slot.increase || 0) + state.increase;
                    slot.pendingCost = true;
                    saveState();
                    maintainRewards();
                } else {
                    $.consoleLn('MSU reward cost cannot increase beyond the supported maximum: ' + slot.name);
                }
            }
            $.channelpoints.updateRedemptionStatusFulfilled(rewardId, redemptionId);
            $.say('MSU pack ' + slot.name + ' will switch at the next track change.');
        } catch (error) {
            $.consoleLn('MSU redemption error: ' + error);
            if (!queued) {
                $.channelpoints.updateRedemptionStatusCancelled(rewardId, redemptionId);
            } else {
                $.consoleLn('MSU request was queued; redemption status may require manual review: ' + redemptionId);
            }
        } finally {
            lock.unlock();
        }
    });


    function toJavaBytes(jsArray) {
        var bytes = Packages.java.lang.reflect.Array.newInstance(Packages.java.lang.Byte.TYPE, jsArray.length);
        for (var i = 0; i < jsArray.length; i++) {
            Packages.java.lang.reflect.Array.setByte(bytes, i, jsArray[i]);
        }
        return bytes;
    }

    function javaByteArrayToJsArray(javaArray) {
        var length = Packages.java.lang.reflect.Array.getLength(javaArray);
        var result = [];
        for (var i = 0; i < length; i++) {
            result.push(Packages.java.lang.reflect.Array.getByte(javaArray, i) & 0xFF);
        }
        return result;
    }

    function readExactly(input, length) {
        var result = [];
        for (var i = 0; i < length; i++) {
            var b = input.read();
            if (b === -1) {
                throw new Error('Unexpected end of stream while reading ' + length + ' bytes');
            }
            result.push(b & 0xFF);
        }
        return result;
    }

    function readHttpLine(input) {
        var line = '';
        while (line.length < 8192) {
            var byte = input.read();
            if (byte === -1) {
                throw new Error('Unexpected end of WebSocket handshake');
            }
            if (byte === 10) {
                return line.endsWith('\r') ? line.slice(0, -1) : line;
            }
            line += String.fromCharCode(byte);
        }
        throw new Error('WebSocket handshake header too long');
    }

    function buildWebSocketAccept(key) {
        var GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
        var sha1 = Packages.java.security.MessageDigest.getInstance('SHA-1');
        var combined = new Packages.java.lang.String(String(key + GUID)).getBytes('UTF-8');
        var digest = sha1.digest(combined);
        return Packages.java.util.Base64.getEncoder().encodeToString(digest);
    }

    function sendWebSocketFrame(output, opcode, payload) {
        $.consoleLn('[MSU DEBUG] sendWebSocketFrame opcode=0x' + opcode.toString(16) + ' payloadLength=' + payload.length);
        output.write(0x80 | (opcode & 0x0F));
        var length = payload.length;
        var maskKey = javaByteArrayToJsArray(new Packages.java.security.SecureRandom().generateSeed(4));
        if (length < 126) {
            output.write(0x80 | length);
        } else if (length <= 0xFFFF) {
            output.write(0x80 | 126);
            output.write((length >> 8) & 0xFF);
            output.write(length & 0xFF);
        } else {
            output.write(0x80 | 127);
            for (var i = 7; i >= 0; i--) {
                output.write((length >> (8 * i)) & 0xFF);
            }
        }
        for (var j = 0; j < 4; j++) {
            output.write(maskKey[j]);
        }
        for (var k = 0; k < length; k++) {
            output.write(payload[k] ^ maskKey[k % 4]);
        }
        output.flush();
        $.consoleLn('[MSU DEBUG] sendWebSocketFrame flushed');
    }

    function readWebSocketFrame(input) {
        $.consoleLn('[MSU DEBUG] readWebSocketFrame: reading first byte');
        var first = input.read();
        if (first === -1) {
            return null;
        }
        $.consoleLn('[MSU DEBUG] readWebSocketFrame: first byte = 0x' + first.toString(16));
        var second = input.read();
        if (second === -1) {
            throw new Error('Invalid websocket frame header');
        }
        var opcode = first & 0x0F;
        var masked = (second & 0x80) !== 0;
        var payloadLength = second & 0x7F;
        if (payloadLength === 126) {
            var extended = readExactly(input, 2);
            payloadLength = (extended[0] << 8) | extended[1];
        } else if (payloadLength === 127) {
            var extended64 = readExactly(input, 8);
            payloadLength = 0;
            for (var i = 0; i < 8; i++) {
                payloadLength = (payloadLength << 8) | extended64[i];
            }
        }
        var maskKey = null;
        if (masked) {
            maskKey = readExactly(input, 4);
        }
        var payload = new Packages.java.io.ByteArrayOutputStream();
        for (var p = 0; p < payloadLength; p++) {
            var b = input.read();
            if (b === -1) {
                throw new Error('Unexpected end of stream while reading websocket payload');
            }
            if (masked) {
                b = b ^ maskKey[p % 4];
            }
            payload.write(b);
        }
        return {
            opcode: opcode,
            data: payload.toByteArray()
        };
    }

    function receiveWebSocketMessage(input, output) {
        $.consoleLn('[MSU DEBUG] receiveWebSocketMessage: waiting for frame');
        while (true) {
            var frame = readWebSocketFrame(input);
            $.consoleLn('[MSU DEBUG] receiveWebSocketMessage: frame=' + (frame ? frame.opcode : 'null'));
            if (!frame) {
                return null;
            }
            if (frame.opcode === 0x9) {
                $.consoleLn('[MSU DEBUG] receiveWebSocketMessage: received PING, sending PONG');
                sendWebSocketFrame(output, 0xA, frame.data);
                continue;
            }
            if (frame.opcode === 0xA) {
                $.consoleLn('[MSU DEBUG] receiveWebSocketMessage: received PONG');
                continue;
            }
            if (frame.opcode === 0x8) {
                $.consoleLn('[MSU DEBUG] receiveWebSocketMessage: received CLOSE');
                return null;
            }
            if (frame.opcode === 0x1 || frame.opcode === 0x2) {
                return frame;
            }
        }
    }

    function parseAddressString(address) {
        if (address === undefined || address === null || address === '') {
            address = DEFAULT_MSU_ADDRESS;
        }
        var normalized = String(address).trim();
        normalized = normalized.replace(/^ws:\/\//i, '');
        normalized = normalized.replace(/^http:\/\//i, '');
        var host = 'localhost';
        var port = 23074;
        var slashPos = normalized.indexOf('/');
        if (slashPos !== -1) {
            normalized = normalized.substring(0, slashPos);
        }
        var parts = normalized.split(':');
        if (parts.length === 2) {
            host = parts[0] || host;
            port = parseInt(parts[1], 10) || port;
        } else if (parts.length === 1 && parts[0].length > 0) {
            host = parts[0];
        }
        return {
            host: host,
            port: port
        };
    }

    function sendWebSocketText(output, message) {
        var payload = new Packages.java.lang.String(String(message)).getBytes('UTF-8');
        $.consoleLn('[MSU DEBUG] sendWebSocketText: message=' + message);
        sendWebSocketFrame(output, 0x1, payload);
        $.consoleLn('[MSU DEBUG] sendWebSocketText: frame sent');
    }

    function sendWebSocketBinary(output, payload) {
        $.consoleLn('[MSU DEBUG] sendWebSocketBinary: payloadLength=' + payload.length);
        sendWebSocketFrame(output, 0x2, payload);
        $.consoleLn('[MSU DEBUG] sendWebSocketBinary: frame sent');
    }

    function switchMsuPack(target, connectionAddress) {
        var address = parseAddressString(connectionAddress);
        var socket = null;
        var input = null;
        var output = null;

        function formatError(e) {
            var message = e && e.javaException ? e.javaException.toString() : (e && e.toString ? e.toString() : String(e));
            if (message.indexOf('SocketTimeoutException') !== -1) {
                message = 'Socket timeout while communicating with MSU server: ' + message;
            }
            return message;
        }

        try {
            $.consoleLn('[MSU DEBUG] Connecting to ' + address.host + ':' + address.port);
            socket = new Packages.java.net.Socket();
            socket.connect(new Packages.java.net.InetSocketAddress(address.host, address.port), 10000);
            socket.setSoTimeout(10000);
            input = socket.getInputStream();
            output = socket.getOutputStream();
            $.consoleLn('[MSU DEBUG] Socket connected, sending handshake');

            var secKeyBytes = new Packages.java.security.SecureRandom().generateSeed(16);
            var secKey = Packages.java.util.Base64.getEncoder().encodeToString(secKeyBytes);
            var handshake = '' +
                'GET / HTTP/1.1\r\n' +
                'Host: ' + address.host + ':' + address.port + '\r\n' +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                'Sec-WebSocket-Key: ' + secKey + '\r\n' +
                'Sec-WebSocket-Version: 13\r\n' +
                '\r\n';
            output.write(new Packages.java.lang.String(String(handshake)).getBytes('UTF-8'));
            output.flush();
            $.consoleLn('[MSU DEBUG] Handshake sent, waiting for status line');

            var statusLine = readHttpLine(input);
            $.consoleLn('[MSU DEBUG] Received status line: ' + statusLine);
            if (statusLine === null || String(statusLine).indexOf('101') === -1) {
                return { success: false, error: 'WebSocket handshake failed: ' + statusLine };
            }

            var expectedAccept = String(buildWebSocketAccept(secKey));
            var acceptValid = false;
            $.consoleLn('[MSU DEBUG] Expected Sec-WebSocket-Accept: ' + expectedAccept);
            while (true) {
                var headerLine = readHttpLine(input);
                if (headerLine === null) {
                    $.consoleLn('[MSU DEBUG] Header line: null');
                    break;
                }
                var headerLineText = String(headerLine);
                $.consoleLn('[MSU DEBUG] Header line: ' + (headerLineText.length === 0 ? '(empty)' : headerLineText));
                if (headerLineText.length === 0) {
                    break;
                }
                var headerParts = headerLineText.split(':');
                $.consoleLn('[MSU DEBUG] Header parse parts=' + headerParts.length + ' raw=' + headerLineText);
                if (headerParts.length >= 2) {
                    var headerName = headerParts[0].trim().toLowerCase();
                    var headerValue = String(headerParts.slice(1).join(':')).trim();
                    $.consoleLn('[MSU DEBUG] Parsed headerName=' + headerName + ' headerValue=' + headerValue + ' expected=' + expectedAccept + ' equal=' + (headerValue === expectedAccept));
                    if (headerName === 'sec-websocket-accept' && headerValue === expectedAccept) {
                        acceptValid = true;
                        $.consoleLn('[MSU DEBUG] Found matching Sec-WebSocket-Accept header');
                    }
                }
            }
            $.consoleLn('[MSU DEBUG] After header loop, acceptValid=' + acceptValid);
            if (!acceptValid) {
                $.consoleLn('[MSU DEBUG] ERROR: Sec-WebSocket-Accept header NOT found or did not match!');
                return { success: false, error: 'WebSocket handshake accept mismatch' };
            }

            function sendJsonRequest(opcode, space, operands, flags) {
                var request = { Opcode: opcode, Space: space };
                if (operands !== undefined) {
                    request.Operands = operands;
                }
                if (flags !== undefined) {
                    request.Flags = flags;
                }
                var payload = JSON.stringify(request);
                $.consoleLn('[MSU DEBUG] sendJsonRequest: ' + payload);
                sendWebSocketText(output, payload);
            }

            function receiveTextReply() {
                $.consoleLn('[MSU DEBUG] receiveTextReply: waiting for text frame');
                var frame = receiveWebSocketMessage(input, output);
                $.consoleLn('[MSU DEBUG] receiveTextReply: frame=' + (frame ? frame.opcode : 'null'));
                if (frame === null || frame.opcode !== 0x1) {
                    return null;
                }
                var text = new Packages.java.lang.String(frame.data, 'UTF-8').toString();
                $.consoleLn('[MSU DEBUG] receiveTextReply: text=' + text);
                return text;
            }

            function receiveBinaryReply() {
                var frame = receiveWebSocketMessage(input, output);
                if (frame === null || frame.opcode !== 0x2) {
                    return null;
                }
                return frame.data;
            }

            sendJsonRequest('DeviceList', 'SNES');
            $.consoleLn('[MSU DEBUG] DeviceList request sent, calling receiveTextReply()');
            var deviceListReply = receiveTextReply();
            $.consoleLn('[MSU DEBUG] receiveTextReply() returned, reply received: ' + (deviceListReply ? 'yes' : 'no'));
            if (!deviceListReply) {
                return { success: false, error: 'No device list reply' };
            }
            var deviceList = JSON.parse(deviceListReply);
            if (!deviceList.Results || deviceList.Results.length === 0) {
                return { success: false, error: 'No SNES device found' };
            }
            var device = deviceList.Results[0];

            sendJsonRequest('Attach', 'SNES', [device]);
            $.consoleLn('[MSU DEBUG] Attach request sent');
            sendJsonRequest('Info', 'SNES', [device]);
            $.consoleLn('[MSU DEBUG] Info request sent, waiting for reply');
            var infoReply = receiveTextReply();
            $.consoleLn('[MSU DEBUG] Info reply received: ' + (infoReply ? 'yes' : 'no'));
            if (!infoReply) {
                return { success: false, error: 'No Info reply' };
            }

            sendJsonRequest('GetAddress', 'SNES', [MSU_PACK_INFO, '2']);
            $.consoleLn('[MSU DEBUG] GetAddress request sent, waiting for binary reply');
            var addressData = receiveBinaryReply();
            $.consoleLn('[MSU DEBUG] GetAddress binary reply received: ' + (addressData ? addressData.length + ' bytes' : 'null'));
            if (!addressData || addressData.length < 2) {
                return { success: false, error: 'Failed to read pack info' };
            }
            var num = addressData[0] & 0xFF;
            var cur = addressData[1] & 0xFF;
            $.consoleLn('[MSU DEBUG] Pack info: num=' + num + ' cur=' + cur);
            if (num === 0) {
                return { success: false, error: 'Not a multi-pack device' };
            }

            if (target === undefined || target === null) {
                var randomTarget = Math.floor(Math.random() * num);
                if (randomTarget === cur) {
                    randomTarget = (randomTarget + 1) % num;
                }
                target = randomTarget;
            } else if (typeof target !== 'number' || !isFinite(target) || Math.floor(target) !== target || target < 0 || target >= num) {
                return { success: false, error: 'Invalid pack index: ' + target };
            }

            var payload = [target & 0xFF];
            $.consoleLn('[MSU DEBUG] Sending PutAddress request with target pack ' + target);
            sendJsonRequest('PutAddress', 'SNES', [MSU_PACK_REQUEST, '1']);
            $.consoleLn('[MSU DEBUG] Sending binary payload');
            sendWebSocketBinary(output, toJavaBytes(payload));
            $.consoleLn('[MSU DEBUG] Pack switch complete');

            return { success: true, pack: target, currentPack: cur, totalPacks: num };
        } catch (e) {
            return { success: false, error: formatError(e) };
        } finally {
            if (socket !== null) {
                try {
                    if (!socket.isClosed()) {
                        socket.close();
                    }
                } catch (ignore) { }
            }
        }
    }

    $.bind('command', function (event) {
        var command = event.getCommand();
        var args = event.getArgs();
        if (String(command).toLowerCase() !== 'msuswitch') {
            return;
        }
        lock.lock();
        try {
            switch (String(args[0] || 'help').toLowerCase()) {
                case 'help':
                    $.say('!msuswitch setup [name, name, ...] | cost <points> | cooldown <seconds> | increase <points> | resetcosts | list | teardown');
                    break;
                case 'list':
                    $.say('MSU cost: ' + state.baseCost + ', increase: ' + state.increase + ', cooldown: ' + state.cooldown + 's. ' +
                        state.slots.map(function (slot, index) {
                            return index + ': ' + slot.name + ' (' + slotCost(slot) + (slot.active && state.active ? ', enabled' : ', disabled') + ')';
                        }).join('; '));
                    break;
                case 'setup':
                    if (!state.baseCost || !state.cooldown) {
                        throw new Error('Set cost and cooldown before setup.');
                    }
                    var names = args.length > 1 ? packNames(Array.prototype.slice.call(args, 1).join(' ').split(',')) : packNames($.readFile(PACK_FILE));
                    if (args.length > 1) {
                        $.saveArray(names, PACK_FILE, false);
                        if (JSON.stringify($.readFile(PACK_FILE)) !== JSON.stringify(names)) {
                            throw new Error('Could not save ' + PACK_FILE + '.');
                        }
                    }
                    setupRewards(names);
                    $.say('MSU rewards configured for ' + names.length + ' packs.');
                    break;
                case 'cost':
                    var newCost = integerSetting(args[1], false);
                    state.slots.forEach(function (slot) {
                        if (newCost + (slot.increase || 0) > MAX_COST) {
                            throw new Error('Cost plus accumulated increase is too large.');
                        }
                    });
                    state.baseCost = newCost;
                    saveState();
                    updateCosts(false);
                    $.say('MSU base cost set to ' + newCost + '.');
                    break;
                case 'cooldown':
                    state.cooldown = integerSetting(args[1], false);
                    saveState();
                    var failures = [];
                    state.slots.forEach(function (slot) {
                        if (slot.id && slot.active) {
                            slot.pendingCooldown = true;
                            saveState();
                            try {
                                updateReward(slot.id, null, null, null, null, state.cooldown);
                                slot.pendingCooldown = false;
                                saveState();
                            } catch (error) {
                                failures.push(slot.name + ': ' + error);
                            }
                        }
                    });
                    if (failures.length) {
                        throw new Error(failures.join('; '));
                    }
                    $.say('MSU cooldown set to ' + state.cooldown + ' seconds.');
                    break;
                case 'increase':
                    state.increase = integerSetting(args[1], true);
                    saveState();
                    $.say('MSU per-redemption increase set to ' + state.increase + '.');
                    break;
                case 'resetcosts':
                    state.slots.forEach(function (slot) { slot.increase = 0; });
                    saveState();
                    updateCosts(true);
                    $.say('MSU reward costs reset.');
                    break;
                case 'teardown':
                    state.active = false;
                    saveState();
                    var disableFailures = [];
                    state.slots.forEach(function (slot) {
                        if (slot.id) {
                            try {
                                updateReward(slot.id, null, null, false, null, null);
                                slot.active = false;
                                slot.pendingDisable = false;
                                saveState();
                            } catch (error) {
                                slot.pendingDisable = true;
                                saveState();
                                disableFailures.push(slot.name + ': ' + error);
                            }
                        }
                    });
                    if (disableFailures.length) {
                        throw new Error(disableFailures.join('; '));
                    }
                    $.say('MSU rewards disabled.');
                    break;
                default:
                    if (!/^\d+$/.test(String(args[0]))) {
                        return;
                    }
                    var result = switchMsuPack(Number(args[0]), args[1] ? String(args[1]) : DEFAULT_MSU_ADDRESS);
                    if (result.success) {
                        $.say('MSU pack ' + result.pack + ' will switch at the next track change.');
                    } else {
                        $.consoleLn('MSU pack switch failed: ' + result.error);
                        $.say('Failed to switch MSU pack.');
                    }
                    break;
            }
        } catch (error) {
            $.consoleLn('MSU switcher: ' + error);
            $.say('MSU switcher error: ' + error.message);
        } finally {
            if (state.slots.some(function (slot) { return slot.pendingCost || slot.pendingCooldown || slot.pendingDisable; })) {
                maintainRewards();
            }
            lock.unlock();
        }
    });

    $.bind('initReady', function () {
        $.registerChatCommand('./custom/msu-switcher.js', 'msuswitch', $.PERMISSION.Admin);
        maintainRewards();
    });

})();
