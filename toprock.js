/**
 * Copyright (C) 2026 cheuer
 *
 * ty meowski
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
    const topRockLines = $.readFile('./addons/toprock.txt');

    // check if lines are loaded
    if (!topRockLines || topRockLines.length === 0) {
        $.consoleLn('Couldn\'t read toprock.txt. Make sure it\'s in the addons folder');
        return;
    }

    function getRandomElement(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    const rhymesWithTop = topRockLines[0].split(',').map(line => line.trim());
    const rhymesWithRock = topRockLines[1].split(',').map(line => line.trim());
    const rhymesWithFrog = topRockLines[2].split(',').map(line => line.trim());
    const twoWordPairs = topRockLines[3].split(',').map(line => line.trim());

    $.bind('command', function (event) {
        const args = event.getArgs();
        const numWords = parseInt(args[0]);
        let message = '';

        if (numWords > 0) {
            // pick random words from all lines
            for (let i = 0; i < numWords; i++) {
                message += getRandomElement([].concat(rhymesWithTop, rhymesWithRock, rhymesWithFrog, twoWordPairs)) + ' ';
            }
            message = message.trim();
        } else {
            const pattern = Math.floor(Math.random() * 4);
            switch (pattern) {
                case 0: // top + rock + frog + rock
                    message = `${getRandomElement(rhymesWithTop)} ${getRandomElement(rhymesWithRock)} ${getRandomElement(rhymesWithFrog)} ${getRandomElement(rhymesWithRock)}`;
                    break;
                case 1: // top + rock + two-word pair
                    message = `${getRandomElement(rhymesWithTop)} ${getRandomElement(rhymesWithRock)} ${getRandomElement(twoWordPairs)}`;
                    break;
                case 2: // two-word pair + frog + rock
                    message = `${getRandomElement(twoWordPairs)} ${getRandomElement(rhymesWithFrog)} ${getRandomElement(rhymesWithRock)}`;
                    break;
                case 3: // two-word pair + two-word pair
                    message = `${getRandomElement(twoWordPairs)} ${getRandomElement(twoWordPairs)}`;
                    break;
            }
        }

        $.say(message);
    });

    $.bind('initReady', function () {
        $.registerChatCommand('./custom/toprock.js', 'toprock', $.PERMISSION.Viewer);
    });

})();
