// Odmiana liczebników w komunikatach (to samo co Speaker.polishGrammar w iOS).
// Szablony mają formę dopełniacza "N watów"; po "do/od/poniżej/powyżej" zostaje bez zmian.
const FORMS: Record<string, [string, string, string]> = {
  'watów': ['wat', 'waty', 'watów'],
  'uderzeń': ['uderzenie', 'uderzenia', 'uderzeń'],
};

export function plForm(n: number, forms: [string, string, string]): string {
  if (n === 1) return forms[0];
  const few = n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14);
  return few ? forms[1] : forms[2];
}

export function polishGrammar(text: string): string {
  return text.replace(/(^|[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż])(do |od |poniżej |powyżej )?(\d+) (watów|uderzeń)/g, (all, pre: string, prep: string | undefined, num: string, word: string) =>
    prep ? all : `${pre}${num} ${plForm(Number(num), FORMS[word])}`);
}
