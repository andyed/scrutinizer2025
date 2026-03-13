// tests/setup.js
// Prevent Node 20+ --localstorage-file warning during Jest teardown
if (typeof global !== 'undefined') {
    Object.defineProperty(global, 'localStorage', {
        value: {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
            clear: () => {},
        },
        configurable: true,
        enumerable: true,
        writable: true,
    });
}
