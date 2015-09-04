

/*@ foo_01 :: (IArray<number>) => number */
function foo_01(n: number[]): number;  // Only the first two are returned as types of foo_01
function foo_01(a: string[]): string;
function foo_01(a: any[]): any {
    if (a.length > 0) {
        return a[0];        
    }
    return 0;
}

foo_01([]);
foo_01([1]);
foo_01([1, 2]);
foo_01([1, 2, 3]);
foo_01([1, 2, 3, 4]);
