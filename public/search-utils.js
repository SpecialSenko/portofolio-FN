(() => {
  function normalize(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function editDistanceWithin(left, right, limit) {
    if (Math.abs(left.length - right.length) > limit) return false;
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let row = 1; row <= left.length; row += 1) {
      const current = [row];
      let rowMinimum = row;
      for (let column = 1; column <= right.length; column += 1) {
        const cost = left[row - 1] === right[column - 1] ? 0 : 1;
        const value = Math.min(
          current[column - 1] + 1,
          previous[column] + 1,
          previous[column - 1] + cost,
        );
        current.push(value);
        rowMinimum = Math.min(rowMinimum, value);
      }
      if (rowMinimum > limit) return false;
      previous = current;
    }
    return previous[right.length] <= limit;
  }

  function tokenMatches(queryToken, candidateToken) {
    if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) return true;
    const tolerance = queryToken.length >= 7 ? 2 : queryToken.length >= 4 ? 1 : 0;
    return tolerance > 0 && editDistanceWithin(queryToken, candidateToken, tolerance);
  }

  function matches(query, ...values) {
    const needle = normalize(query);
    if (!needle) return true;
    const haystack = normalize(values.filter(Boolean).join(" "));
    if (!haystack) return false;
    if (haystack.includes(needle)) return true;
    if (haystack.replace(/\s/g, "").includes(needle.replace(/\s/g, ""))) return true;
    const candidateTokens = haystack.split(" ");
    return needle.split(" ").every((queryToken) =>
      candidateTokens.some((candidateToken) => tokenMatches(queryToken, candidateToken))
    );
  }

  window.FraxbSearch = Object.freeze({ matches, normalize });
})();
