# 辞書：いろいろな型のキー、挿入順、1 と 1.0 と True は同じキー
d = {2: "two", "b": "bee", (1, 2): "pair", None: "none"}
d[1] = "one"
d[1.0] = "ONE"
d[True] = "TRUE"
print(d, len(d), d[(1, 2)], 1 in d, 1.0 in d, (1, 2) in d, [1, 2] == [1, 2])
d.pop("b")
d["b"] = "again"
print(list(d.keys()), list(d.values()))
for k, v in d.items():
    print(k, v, end="; ")
print()
counts = {}
for ch in "mississippi":
    counts[ch] = counts.get(ch, 0) + 1
print(counts, sorted(counts), max(counts, key=counts.get) if False else sorted(counts.items()))
grid = {}
for x in range(3):
    for y in range(2):
        grid[(x, y)] = x * y
print(grid[(2, 1)], len(grid), dict([("a", 1), ("b", 2)]), dict(x=1), {} == {}, {1: 2} == {1.0: 2})
print(counts.setdefault("z", 0), counts.setdefault("m", 9), counts.copy() == counts)

# 大きな整数
def factorial(n):
    result = 1
    for i in range(2, n + 1):
        result *= i
    return result

print(factorial(25), factorial(30) // factorial(28), 2 ** 64, 2 ** 64 - 1, -(2 ** 70), 10 ** 20 // 7, 10 ** 20 % 7)
print(-(10 ** 20) // 7, -(10 ** 20) % 7, (2 ** 53) + 1, 9007199254740993 - 2, 2 ** 100 == 2 ** 100, 2 ** 64 > 2 ** 63)
print(int("123456789012345678901234567890"), str(3 ** 50), abs(-(2 ** 60)), 2 ** 64 / 2 ** 62, 7 ** 30 % 1000)
fib = [0, 1]
for i in range(90):
    fib.append(fib[-1] + fib[-2])
print(fib[90], fib[-1] % 1000000007, sum(fib[80:]), round(2 ** 60), {2 ** 64: "big"}[2 ** 64])
print(1 << 40, 1 << 70, (1 << 70) >> 65, 0xFFFFFFFFFF & 0xF0F0F0F0F0, 5 ^ (1 << 40), ~(2 ** 64), -7 // 2, -7 % 2)
print(f"{2 ** 64:,}", f"{10 ** 18:d}", 2 ** 63 == 9223372036854775808, 12345678901234567890)

# 連続代入
a = b = c = 0
a += 1
print(a, b, c)
xs = ys = [1]
xs.append(2)
print(xs, ys, xs is ys)
p, q = r = (3, 4)
print(p, q, r)
