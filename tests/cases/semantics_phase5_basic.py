# 内包表記
xs = [3, -1, 4, -1, 5, 9]
squares = [x * x for x in xs if x > 0]
pairs = [(i, j) for i in range(3) for j in range(i)]
lookup = {w: len(w) for w in ["a", "bb", "ccc"]}
evens = {x % 2 for x in xs}
total = sum(x for x in xs if x > 0)
nested = [[c for c in row] for row in ["ab", "cd"]]
print(squares, pairs, lookup, sorted(evens), total, nested)
x = "outer"
ys = [x for x in range(2)]
print(x, ys)

# set
s = {3, 1, 2}
s.add(5)
s.discard(1)
t = set([2, 3, 7])
print(sorted(s), sorted(s | t), sorted(s & t), sorted(s - t), sorted(s ^ t), 2 in s, len(s))
print({1, 2} <= {1, 2, 3}, {1, 2} < {1, 2}, set() == set([]), sorted(set("banana")))

# del・スライスへの代入
a = list(range(8))
del a[0]
del a[1:3]
a[1:2] = [10, 20, 30]
a[::2] = [0, 0, 0, 0]
d = {"x": 1, "y": 2}
del d["x"]
gone = 5
del gone
print(a, d)

# for / while の else
for n in range(2, 10):
    for k in range(2, n):
        if n % k == 0:
            break
    else:
        print(n, end=" ")
print()
i = 0
while i < 3:
    i += 1
else:
    print("done", i)

# % 書式
print("%d-%s-%r-%5.2f|%-4s|%04d|%x|%%" % (7, "a", "b", 3.14159, "z", 42, 255))
print("%s" % "solo", "%e" % 12345.678, "%+d" % 5)

# *args・**kwargs・キーワード専用引数
def f(a, *args, b=1, **kw):
    return a, args, b, kw

def g(*, key):
    return key

print(f(1), f(1, 2, 3, b=4, c=5), g(key="k"))
nums = [1, 2, 3]
opts = {"b": 9, "z": 0}
print(f(*nums, **opts), max(*nums), print(*nums, sep=","))
