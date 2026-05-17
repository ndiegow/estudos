# Estudos Concurso — PWA com sincronização

App pessoal para controle de estudos com revisão espaçada, com **sincronização em tempo real entre dispositivos** (celular, tablet, PC) via Firebase.

## Como funciona

- Login com sua conta Google
- Dados ficam no Firebase Firestore (cloud), sincronizados entre todos os seus dispositivos automaticamente
- Funciona offline: usa cache local; sincroniza assim que volta online
- Faça um registro no celular, ele aparece no PC em poucos segundos

## Deploy (passo a passo)

### 1. Subir os arquivos no GitHub
Como antes: criar repositório privado `estudos`, arrastar todos os arquivos, ativar GitHub Pages em Settings → Pages → branch `main`.

### 2. **Crítico** — Adicionar o domínio do GitHub Pages em Firebase

Depois do GitHub Pages ativar, vai te dar uma URL tipo:
```
https://SEU_USUARIO.github.io/estudos/
```

Vá em **console.firebase.google.com** → seu projeto → **Authentication** → aba **Settings** (engrenagem ⚙️) → **Authorized domains** → **Add domain** → digite **`SEU_USUARIO.github.io`** (sem https, sem caminho) → **Add**.

Sem isso, o login com Google **vai falhar** quando você abrir o site.

### 3. Abrir no celular
Abra a URL no Chrome → menu → **Adicionar à tela inicial** → vira app.

Na primeira abertura, fazer login com Google. Pronto.

## Uso em múltiplos dispositivos

Repita o passo 3 em cada dispositivo (PC, tablet, celular). Faça login com **a mesma conta Google** em todos. Os dados aparecem sincronizados.

## Como atualizar o código

Quando quiser modificar o app:
1. Faça as alterações nos arquivos
2. Suba a nova versão no GitHub (mesma forma que da primeira vez)
3. Em poucos minutos, todos os dispositivos pegam a nova versão (pode precisar fechar e reabrir o app)

## Backup

Mesmo com sincronização, **faça backup** ocasionalmente. Em Config → **Exportar dados (JSON)**. Guarda no Drive. Se algo der muito errado, restaure com **Importar dados**.

## Sobre custo do Firebase

O plano gratuito (Spark) tem **muito mais que o suficiente** para uso pessoal:
- 1 GiB de armazenamento (você usaria centésimos disso em anos)
- 50.000 leituras por dia
- 20.000 escritas por dia
- 20.000 deleções por dia

Não tem cartão de crédito cadastrado — então mesmo que extrapolasse, ele simplesmente bloquearia até o dia seguinte (nunca cobra).

## Privacidade

- Dados ficam em `users/{seu_uid}/...` no Firestore
- As regras de segurança garantem que SOMENTE você (autenticado com sua conta Google) consegue ler/escrever seus dados
- O repositório no GitHub pode até ser privado, mas as chaves do Firebase no código são públicas por design (a segurança vem das regras do Firestore, não do segredo das chaves)

## Sobre a simulação de teste

Em Config → **Carregar simulação de 1 mês**: substitui todos os dados por 30 dias de estudo simulado, para você testar como o app se comporta com dados realistas.

## Resolução de problemas

**"auth/unauthorized-domain"** — você esqueceu o passo 2. Adicione o domínio em Authorized domains.

**"O app não atualiza entre dispositivos"** — confira se está logado com a mesma conta Google em todos. Se sim, force atualização puxando para baixo (pull to refresh) ou feche e reabra.

**"Não consigo fazer login no celular"** — abra primeiro pelo navegador normal (não como app instalado), faça login, depois adicione à home screen. O cookie de autenticação fica salvo.

## Estrutura

```
estudos/
├── index.html         # Estrutura + tela de login
├── app.js             # Lógica (módulo ES, importa Firebase via CDN)
├── style.css          # Visual Apple-style
├── manifest.json      # Configuração PWA
├── sw.js              # Service worker
├── icon-192.png       # Ícone
├── icon-512.png       # Ícone
└── README.md          # Este arquivo
```
