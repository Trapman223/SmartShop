#!/usr/bin/env python3
"""
Smart-Shop — génère un HTML imprimable à partir du compte-rendu Markdown.

Aucune dépendance : ni pandoc, ni npm, ni pip. Le Markdown du compte-rendu
n'utilise qu'un sous-ensemble connu (titres, tableaux, blocs de code, listes,
citations, règles horizontales, emphase et code en ligne), que ce script
couvre entièrement.

Usage :
    python3 scripts/build-compte-rendu.py
    # puis ouvrir le HTML et imprimer en PDF (Cmd+P → Enregistrer au format PDF)
"""

import html
import os
import re
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(RACINE, 'docs', 'compte-rendu', 'compte-rendu.md')
CIBLE = os.path.join(RACINE, 'docs', 'compte-rendu', 'compte-rendu.html')

CSS = """
@page { size: A4; margin: 18mm 16mm; }
:root {
  --encre: #1a1d23; --doux: #5a6270; --trait: #d8dce3;
  --fond-code: #f6f7f9; --accent: #1f4e79;
}
* { box-sizing: border-box; }
body {
  font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: var(--encre); line-height: 1.6; font-size: 10.5pt;
  max-width: 190mm; margin: 0 auto; padding: 12mm 6mm;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
h1 { font-size: 21pt; color: var(--accent); margin: 0 0 .4em; line-height: 1.25; }
h2 {
  font-size: 15pt; color: var(--accent); margin: 1.9em 0 .6em;
  padding-bottom: .25em; border-bottom: 2px solid var(--trait);
  page-break-after: avoid;
}
h3 { font-size: 12.5pt; margin: 1.4em 0 .4em; page-break-after: avoid; }
h4 { font-size: 11pt; margin: 1.1em 0 .35em; color: var(--doux); page-break-after: avoid; }
p { margin: .6em 0; }
strong { font-weight: 650; }
hr { border: none; border-top: 1px solid var(--trait); margin: 1.8em 0; }
a { color: var(--accent); }

table {
  border-collapse: collapse; width: 100%; margin: 1em 0;
  font-size: 9.5pt; page-break-inside: avoid;
}
th, td { border: 1px solid var(--trait); padding: .42em .6em; text-align: left; vertical-align: top; }
th { background: #eef1f5; font-weight: 650; }
tr:nth-child(even) td { background: #fafbfc; }

pre {
  background: var(--fond-code); border: 1px solid var(--trait);
  border-radius: 4px; padding: .7em .9em; overflow-x: auto;
  font-size: 8.4pt; line-height: 1.42; page-break-inside: avoid;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  white-space: pre;
}
code {
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: .88em; background: var(--fond-code);
  padding: .1em .32em; border-radius: 3px;
}
pre code { background: none; padding: 0; font-size: inherit; }

blockquote {
  margin: 1em 0; padding: .6em 1em; border-left: 3px solid var(--accent);
  background: #f4f7fa; color: #2c3440; page-break-inside: avoid;
}
blockquote p { margin: .3em 0; }

ul, ol { margin: .6em 0; padding-left: 1.5em; }
li { margin: .28em 0; }

@media print {
  body { padding: 0; max-width: none; }
  h2 { page-break-before: always; }
  h2:first-of-type { page-break-before: avoid; }
}
"""


def en_ligne(texte):
    """Emphase, code en ligne et liens — le code en ligne est protégé d'abord."""
    jetons = []

    def garder(m):
        jetons.append('<code>%s</code>' % html.escape(m.group(1)))
        return '\x00%d\x00' % (len(jetons) - 1)

    texte = re.sub(r'`([^`]+)`', garder, texte)
    texte = html.escape(texte)
    texte = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', texte)
    texte = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', texte)
    texte = re.sub(r'(?<![\w*])\*([^*\n]+)\*(?![\w*])', r'<em>\1</em>', texte)
    texte = re.sub(r'(?<![\w_])_([^_\n]+)_(?![\w_])', r'<em>\1</em>', texte)
    return re.sub(r'\x00(\d+)\x00', lambda m: jetons[int(m.group(1))], texte)


def ligne_tableau(ligne):
    cellules = [c.strip() for c in ligne.strip().strip('|').split('|')]
    return cellules


def convertir(md):
    lignes = md.split('\n')
    sortie = []
    i = 0
    n = len(lignes)

    while i < n:
        ligne = lignes[i]

        # Bloc de code clôturé
        if ligne.startswith('```'):
            i += 1
            bloc = []
            while i < n and not lignes[i].startswith('```'):
                bloc.append(lignes[i])
                i += 1
            i += 1
            sortie.append('<pre><code>%s</code></pre>' % html.escape('\n'.join(bloc)))
            continue

        # Règle horizontale
        if re.fullmatch(r'-{3,}', ligne.strip()):
            sortie.append('<hr />')
            i += 1
            continue

        # Titre
        m = re.match(r'^(#{1,6})\s+(.*)$', ligne)
        if m:
            niveau = len(m.group(1))
            sortie.append('<h%d>%s</h%d>' % (niveau, en_ligne(m.group(2)), niveau))
            i += 1
            continue

        # Tableau : une ligne d'en-tête suivie d'un séparateur
        if (ligne.strip().startswith('|') and i + 1 < n
                and re.fullmatch(r'\|[\s:|-]+\|', lignes[i + 1].strip())):
            entetes = ligne_tableau(ligne)
            i += 2
            corps = []
            while i < n and lignes[i].strip().startswith('|'):
                corps.append(ligne_tableau(lignes[i]))
                i += 1
            html_tab = ['<table><thead><tr>']
            html_tab += ['<th>%s</th>' % en_ligne(c) for c in entetes]
            html_tab.append('</tr></thead><tbody>')
            for rangee in corps:
                html_tab.append('<tr>')
                html_tab += ['<td>%s</td>' % en_ligne(c) for c in rangee]
                html_tab.append('</tr>')
            html_tab.append('</tbody></table>')
            sortie.append(''.join(html_tab))
            continue

        # Citation
        if ligne.startswith('>'):
            bloc = []
            while i < n and lignes[i].startswith('>'):
                bloc.append(lignes[i].lstrip('>').lstrip())
                i += 1
            paragraphes = '\n'.join(bloc).split('\n\n')
            contenu = ''.join(
                '<p>%s</p>' % en_ligne(' '.join(p.split()))
                for p in paragraphes if p.strip()
            )
            sortie.append('<blockquote>%s</blockquote>' % contenu)
            continue

        # Liste à puces ou numérotée
        m = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)$', ligne)
        if m:
            ordonnee = not m.group(2) in ('-', '*')
            balise = 'ol' if ordonnee else 'ul'
            elements = []
            while i < n:
                m2 = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)$', lignes[i])
                if not m2:
                    # Continuation indentée de l'élément courant.
                    if elements and lignes[i].startswith('  ') and lignes[i].strip():
                        elements[-1] += ' ' + lignes[i].strip()
                        i += 1
                        continue
                    break
                elements.append(m2.group(3))
                i += 1
            sortie.append('<%s>%s</%s>' % (
                balise,
                ''.join('<li>%s</li>' % en_ligne(e) for e in elements),
                balise,
            ))
            continue

        # Ligne vide
        if not ligne.strip():
            i += 1
            continue

        # Paragraphe
        bloc = []
        while i < n and lignes[i].strip() and not re.match(
                r'^(#{1,6}\s|```|>|\s*([-*]|\d+\.)\s|\|)', lignes[i]) \
                and not re.fullmatch(r'-{3,}', lignes[i].strip()):
            bloc.append(lignes[i].strip())
            i += 1
        if bloc:
            sortie.append('<p>%s</p>' % en_ligne(' '.join(bloc)))
        else:
            i += 1

    return '\n'.join(sortie)


def main():
    if not os.path.exists(SOURCE):
        sys.exit('Source introuvable : %s' % SOURCE)

    with open(SOURCE, encoding='utf-8') as f:
        md = f.read()

    corps = convertir(md)
    page = (
        '<!doctype html>\n<html lang="fr">\n<head>\n'
        '<meta charset="utf-8" />\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1" />\n'
        '<title>Smart-Shop — Compte-rendu</title>\n'
        '<style>%s</style>\n</head>\n<body>\n%s\n</body>\n</html>\n'
        % (CSS, corps)
    )

    with open(CIBLE, 'w', encoding='utf-8') as f:
        f.write(page)

    print('HTML généré : %s' % CIBLE)
    print()
    print('Pour obtenir le PDF :')
    print('  1. open "%s"' % CIBLE)
    print('  2. Cmd+P → Destination « Enregistrer au format PDF »')
    print('  3. Décocher en-têtes et pieds de page, marges « Par défaut »')


if __name__ == '__main__':
    main()
