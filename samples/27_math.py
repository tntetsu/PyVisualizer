import math

def distance(p, q):
    return math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2)

points = [(0, 0), (3, 4), (6, 8)]
total = 0
for i in range(len(points) - 1):
    total += distance(points[i], points[i + 1])
print(total, math.floor(total), math.gcd(12, 18))
area = math.pi * 2 ** 2
print(f"{area:.3f}")
