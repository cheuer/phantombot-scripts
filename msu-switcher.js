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
    let packList = [];


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
            socket = new Packages.java.net.Socket(address.host, address.port);
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

            var reader = new Packages.java.io.BufferedReader(new Packages.java.io.InputStreamReader(input, 'UTF-8'));
            var statusLine = reader.readLine();
            $.consoleLn('[MSU DEBUG] Received status line: ' + statusLine);
            if (statusLine === null || String(statusLine).indexOf('101') === -1) {
                return { success: false, error: 'WebSocket handshake failed: ' + statusLine };
            }

            var expectedAccept = String(buildWebSocketAccept(secKey));
            var acceptValid = false;
            $.consoleLn('[MSU DEBUG] Expected Sec-WebSocket-Accept: ' + expectedAccept);
            while (true) {
                var headerLine = reader.readLine();
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

            if (target === undefined || target === null || isNaN(target) || target < 0 || target >= num) {
                var randomTarget = Math.floor(Math.random() * num);
                if (randomTarget === cur) {
                    randomTarget = (randomTarget + 1) % num;
                }
                target = randomTarget;
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
                } catch (ignore) {}
            }
        }
    }

    $.bind('command', function (event) {
        var command = event.getCommand();
        var sender = event.getSender();
        var args = event.getArgs();

        switch (String(args[0])) {
            case 'help':
                $.say('Usage: tbd');
                break;

            case 'list':
                // print list of available MSUs
                break;

            case 'setup':
                let list = String(args[1]);
                packList = list.split(',').map(s => s.trim());

                // create channel point redeems for each pack


                break;

            default:
                if (args[0] === undefined || isNaN(args[0])) {
                    return;
                }
                var parsedTarget = parseInt(args[0], 10);
                var connectionAddress = args[1] ? String(args[1]) : DEFAULT_MSU_ADDRESS;
                var result = switchMsuPack(parsedTarget, connectionAddress);
                if (result.success) {
                    $.say('MSU switched to pack ' + result.pack + '.');
                } else {
                    $.consoleLn('MSU pack switch failed: ' + result.error);
                    $.say('Failed to switch MSU pack');
                }
                break;
        }
    });

    $.bind('initReady', function () {
        $.registerChatCommand('./custom/msu-switcher.js', 'msuswitch', $.PERMISSION.Admin);
    });

})();
