class PerformanceMonitor {
    constructor() {
        this.measurements = [];
        this.intervalId = null;
        this.startTime = Date.now();
    }

    startMonitoring() {
        console.log('🔍 Performance Monitor Started');
        
        // Monitor CPU usage every second
        this.intervalId = setInterval(() => {
            this.collectMetrics();
        }, 1000);

        // Monitor long tasks
        if ('PerformanceObserver' in window) {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.duration > 50) { // Tasks longer than 50ms
                        console.warn(`⚠️ Long task detected: ${entry.name} (${entry.duration.toFixed(2)}ms)`);
                    }
                }
            });
            
            try {
                observer.observe({ entryTypes: ['longtask'] });
            } catch (e) {
                console.log('Long task monitoring not supported');
            }
        }

        // Monitor event loop lag
        this.monitorEventLoopLag();

        // Monitor DOM mutations
        this.monitorDOMMutations();
    }

    collectMetrics() {
        const now = Date.now();
        const uptime = (now - this.startTime) / 1000;
        
        // Get memory usage
        if (performance.memory) {
            const memoryMB = performance.memory.usedJSHeapSize / 1048576;
            const limitMB = performance.memory.jsHeapSizeLimit / 1048576;
            const percentage = (memoryMB / limitMB) * 100;
            
            console.log(`📊 Memory: ${memoryMB.toFixed(2)}MB / ${limitMB.toFixed(2)}MB (${percentage.toFixed(1)}%)`);
            
            if (percentage > 80) {
                console.error('⚠️ HIGH MEMORY USAGE!');
            }
        }

        // Count DOM nodes
        const nodeCount = document.getElementsByTagName('*').length;
        console.log(`📋 DOM Nodes: ${nodeCount}`);
        
        if (nodeCount > 1500) {
            console.warn('⚠️ High DOM node count!');
        }

        // Check for detached nodes (memory leaks)
        this.checkDetachedNodes();
    }

    monitorEventLoopLag() {
        let lastCheck = Date.now();
        
        const checkLag = () => {
            const now = Date.now();
            const lag = now - lastCheck - 100; // Should be ~100ms
            
            if (lag > 50) {
                console.warn(`⚠️ Event loop lag detected: ${lag}ms`);
            }
            
            lastCheck = now;
            setTimeout(checkLag, 100);
        };
        
        setTimeout(checkLag, 100);
    }

    monitorDOMMutations() {
        let mutationCount = 0;
        let lastReset = Date.now();
        
        const observer = new MutationObserver((mutations) => {
            mutationCount += mutations.length;
            
            // Check every second
            const now = Date.now();
            if (now - lastReset > 1000) {
                if (mutationCount > 100) {
                    console.warn(`⚠️ High DOM mutation rate: ${mutationCount} mutations/sec`);
                }
                mutationCount = 0;
                lastReset = now;
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true
        });
    }

    checkDetachedNodes() {
        // Check for common memory leak patterns
        const terminalCount = document.querySelectorAll('.terminal').length;
        const loaderCount = document.querySelectorAll('.terminal-loader').length;
        const placeholderCount = document.querySelectorAll('.terminal-placeholder').length;
        
        console.log(`🔍 Components: Terminals=${terminalCount}, Loaders=${loaderCount}, Placeholders=${placeholderCount}`);
    }

    measureFunction(name, fn) {
        return function(...args) {
            const start = performance.now();
            const result = fn.apply(this, args);
            const duration = performance.now() - start;
            
            if (duration > 10) {
                console.log(`⏱️ ${name} took ${duration.toFixed(2)}ms`);
            }
            
            return result;
        };
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            console.log('🛑 Performance Monitor Stopped');
        }
    }
}

module.exports = PerformanceMonitor;