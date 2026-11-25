def parse_scores(texts):
    scores = []
    for t in texts:
        try:
            scores.append(int(t))
        except ValueError:
            print("skip:", t)
    return scores

def average(scores):
    if not scores:
        raise ValueError("no scores")
    return sum(scores) / len(scores)

scores = parse_scores(["80", "x", "95", "70"])
print(scores, average(scores))
try:
    average([])
except ValueError as e:
    print("error:", e)
