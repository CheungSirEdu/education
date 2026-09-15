(function () {
  var colors = ["gold", "blue", "white"];
  var pick = colors[Math.floor(Math.random() * colors.length)];
  document.querySelectorAll("img.zhang-sir-mark").forEach(function (img) {
    var src = img.getAttribute("src") || "assets/zhang-sir-gold.png";
    var dir = src.split("?")[0].replace(/[^/]+$/, "");
    img.src = dir + "zhang-sir-" + pick + ".png";
  });
})();
