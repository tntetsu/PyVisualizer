# 出力だけを CPython と比べる（sorted が __lt__ を呼ぶ順序・回数は CPython と違うため。ADR-006）
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __repr__(self):
        return f"Point({self.x}, {self.y})"

    def __lt__(self, other):
        return (self.x, self.y) < (other.x, other.y)

points = [Point(2, 1), Point(1, 5), Point(1, 2), Point(0, 9)]
print(sorted(points), sorted(points, reverse=True)[0])
points.sort()
print(points)
