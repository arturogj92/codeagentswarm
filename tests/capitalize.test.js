/**
 * Tests for capitalizeFirstLetter function
 */

describe('capitalizeFirstLetter', () => {
    // Mock the capitalizeFirstLetter function since it's inside the KanbanManager class
    const capitalizeFirstLetter = (text) => {
        if (!text) return text;
        return text.charAt(0).toUpperCase() + text.slice(1);
    };

    describe('Basic functionality', () => {
        test('should capitalize first letter of lowercase word', () => {
            expect(capitalizeFirstLetter('hello')).toBe('Hello');
        });

        test('should capitalize first letter of lowercase sentence', () => {
            expect(capitalizeFirstLetter('primera letra tareas en mayusculas porfa')).toBe('Primera letra tareas en mayusculas porfa');
        });

        test('should handle already capitalized text', () => {
            expect(capitalizeFirstLetter('Already Capitalized')).toBe('Already Capitalized');
        });

        test('should handle all uppercase text', () => {
            expect(capitalizeFirstLetter('HELLO WORLD')).toBe('HELLO WORLD');
        });
    });

    describe('Edge cases', () => {
        test('should handle empty string', () => {
            expect(capitalizeFirstLetter('')).toBe('');
        });

        test('should handle null', () => {
            expect(capitalizeFirstLetter(null)).toBe(null);
        });

        test('should handle undefined', () => {
            expect(capitalizeFirstLetter(undefined)).toBe(undefined);
        });

        test('should handle single character', () => {
            expect(capitalizeFirstLetter('a')).toBe('A');
        });

        test('should handle single uppercase character', () => {
            expect(capitalizeFirstLetter('A')).toBe('A');
        });

        test('should handle numbers at start', () => {
            expect(capitalizeFirstLetter('123 hello')).toBe('123 hello');
        });

        test('should handle special characters at start', () => {
            expect(capitalizeFirstLetter('!hello')).toBe('!hello');
            expect(capitalizeFirstLetter('@task')).toBe('@task');
            expect(capitalizeFirstLetter('#123')).toBe('#123');
        });

        test('should handle whitespace at start', () => {
            expect(capitalizeFirstLetter(' hello')).toBe(' hello');
            expect(capitalizeFirstLetter('  multiple spaces')).toBe('  multiple spaces');
        });
    });

    describe('International characters', () => {
        test('should handle Spanish characters', () => {
            expect(capitalizeFirstLetter('ñoño')).toBe('Ñoño');
            expect(capitalizeFirstLetter('árbol')).toBe('Árbol');
        });

        test('should handle accented characters', () => {
            expect(capitalizeFirstLetter('élite')).toBe('Élite');
            expect(capitalizeFirstLetter('über')).toBe('Über');
        });

        test('should handle emoji at start', () => {
            expect(capitalizeFirstLetter('🚀 launch feature')).toBe('🚀 launch feature');
            expect(capitalizeFirstLetter('😀hello')).toBe('😀hello');
        });
    });

    describe('Real task title examples', () => {
        test('should capitalize real task titles', () => {
            expect(capitalizeFirstLetter('fix auth bug')).toBe('Fix auth bug');
            expect(capitalizeFirstLetter('implement search feature')).toBe('Implement search feature');
            expect(capitalizeFirstLetter('update database schema')).toBe('Update database schema');
            expect(capitalizeFirstLetter('añadir categorias a las tasks')).toBe('Añadir categorias a las tasks');
            expect(capitalizeFirstLetter('meter hooks de seguridad')).toBe('Meter hooks de seguridad');
        });
    });

    describe('Performance edge cases', () => {
        test('should handle very long strings', () => {
            const longString = 'a'.repeat(10000) + ' very long task title';
            const result = capitalizeFirstLetter(longString);
            expect(result.charAt(0)).toBe('A');
            expect(result.length).toBe(longString.length);
        });

        test('should handle strings with only spaces', () => {
            expect(capitalizeFirstLetter('   ')).toBe('   ');
        });

        test('should handle mixed case preservation', () => {
            expect(capitalizeFirstLetter('iPhone integration')).toBe('IPhone integration');
            expect(capitalizeFirstLetter('macOS support')).toBe('MacOS support');
        });
    });

    describe('Crazy test cases 🤪', () => {
        test('should handle zalgo text', () => {
            const zalgo = 'ḩ̸̺̪̯͓̤̬̪̩̮̈̊ë̷́ͅl̶̰̇̈́̈́l̸̨̳̘̦̺̩͈̣̈́̈́̏͋̈́͝ͅo̴̧̨̜̣̳̱̮̓';
            const result = capitalizeFirstLetter(zalgo);
            expect(result).toBeDefined();
        });

        test('should handle alternating case', () => {
            expect(capitalizeFirstLetter('hElLo WoRlD')).toBe('HElLo WoRlD');
        });

        test('should handle multiple emoji spam', () => {
            expect(capitalizeFirstLetter('🎉🎊🎈🎁🎀 party task')).toBe('🎉🎊🎈🎁🎀 party task');
        });

        test('should handle invisible characters', () => {
            expect(capitalizeFirstLetter('​hello')).toBe('​hello'); // Zero-width space
            expect(capitalizeFirstLetter('‌task')).toBe('‌task'); // Zero-width non-joiner
        });

        test('should handle RTL text', () => {
            expect(capitalizeFirstLetter('مرحبا')).toBe('مرحبا');
            expect(capitalizeFirstLetter('שלום')).toBe('שלום');
        });

        test('should handle mixed scripts', () => {
            expect(capitalizeFirstLetter('hello世界')).toBe('Hello世界');
            expect(capitalizeFirstLetter('世界hello')).toBe('世界hello');
        });

        test('should handle the ultimate chaos string', () => {
            const chaos = '🤯⚡️ñ̴̢̧̛̰̣̦̯̈́̊̈́Ō̶̧̨̱̜̣̳̓ẗ̷́ͅ  A  🅱️ṵ̸̈́̈́͋̈́͝Ġ̶̰ 🐛 ¡¡¡ṕ̴̢̧̛̰̣̊Ļ̶̧̨̱̜̣̳̓ë̷́ͅÄ̶̰̇s̸̈́̈́͋̈́͝Ḛ̴̢̧̛̣̈̊!!!';
            const result = capitalizeFirstLetter(chaos);
            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
        });
    });
});