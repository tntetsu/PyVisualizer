a = [1, 2, 3]
b = a
b += [4]
print(a, a is b)
c = a
c = c + [5]
print(a, c)
s = "hello world"
print(s[0], s[-1], s[1:4], s[::-1], s[::2], s[-3:], s[100:], len(s))
xs = list(range(10))
print(xs[2:8:3], xs[8:2:-2], xs[-3:-1], xs[:])
t = (1, 2, 3)
print(t, t[1:], (5,), (), t + (4,), t * 2, [0] * 3, "ab" * 3)
p, q = 1, 2
p, q = q, p
print(p, q)
(m, n), r = (1, 2), 3
print(m, n, r)
grid = [[0, 0], [0, 0]]
grid[1][0] = 7
print(grid)
nums = [3, 1, 2]
nums.append(5)
nums.insert(0, 9)
print(nums.pop(), nums.pop(0), nums, nums.index(2), nums.count(1))
nums.sort(reverse=True)
print(nums, sorted("banana"), list("abc"), tuple([1, 2]), reversed([1, 2, 3]) is not None)
print(min(4, 2, 8), max([1, 5, 3]), sum([1, 2, 3]), sum([0.5, 0.5]), min(["bb", "a"], key=len))
print(list(enumerate("ab")), list(zip([1, 2, 3], "ab")))
