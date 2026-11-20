(() => {
  const search = document.getElementById("helpSearch");
  const query = document.getElementById("helpQuery");
  const result = document.getElementById("helpResult");
  const topics = document.querySelector(".help-topics");
  const normalize = text => text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[’']/g, "");
  const sections = [...document.querySelectorAll("#helpArticles section")].map(section => {
    const title = section.querySelector("h2").textContent;
    return {
      section,
      articles: [...section.querySelectorAll("details")].map(article => ({
        article,
        text: normalize(`${title} ${article.dataset.keywords || ""} ${article.textContent}`)
      }))
    };
  });

  function filterHelp() {
    const terms = normalize(query.value).match(/[\p{L}\p{N}]+/gu) || [];
    let matches = 0;
    for (const { section, articles } of sections) {
      let visible = false;
      for (const { article, text } of articles) {
        const match = terms.every(term => text.includes(term));
        article.hidden = !match;
        if (match) { matches++; visible = true; }
      }
      section.hidden = !visible;
    }
    topics.hidden = terms.length > 0;
    result.textContent = !terms.length ? "" : matches
      ? `${matches} ${matches === 1 ? "article" : "articles"} found` : "No articles found. Try a shorter search.";
  }

  query.addEventListener("input", filterHelp);
  search.hidden = false;
  filterHelp();
})();
